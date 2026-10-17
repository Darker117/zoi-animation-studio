"""Studio AI server: text to motion with MSFlow (Qing Yu and Kent Fujiwara, LY Corporation).

Listens on 127.0.0.1 (the helper passes the port: its own port + 100, so 47920 normally). The Studio helper (bridge/server.ps1) starts it the
first time the studio asks for the AI and passes its own process id; the server exits by itself when
that helper exits.

  GET  /api/ai/status    {"ok": true, "ready": bool, "state": "loading"|"ready"|"error", "device": str, "message": str}
  POST /api/ai/generate  {"text": str, "seconds": float, "seed": int}
                         -> {"ok": true, "fps": 20, "frames": N, "joints": [[[x, y, z] * 22] * N]}

The joints use the HumanML3D layout (22 SMPL joints, metres, Y up, starting to face +Z); the studio
turns them into an editable animation (studio/js/core/fromJoints.js).

  python server.py --selftest    load the model, generate one short motion, print a JSON result
"""
import argparse
import ctypes
import json
import os
import re
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "msflow"))
MODELS = os.path.join(HERE, "models")
CKPT_DIR = os.path.join(MODELS, "MMDiT_xyz_pretrained")
BERT_DIR = os.path.join(MODELS, "distilbert-base-uncased")
MEAN_STD = os.path.join(HERE, "msflow", "utils", "22x3_mean_std", "t2m")
LOG = os.path.join(HERE, "runtime", "server.log")

FPS = 20                      # MSFlow works at 20 frames per second
MIN_FRAMES, MAX_FRAMES = 40, 196   # the lengths it was trained on (2 to 9.8 seconds)
CFG_SCALE = 3.0               # guidance strength used by MSFlow's own demo
LOCAL_ORIGIN = re.compile(r"^http://(localhost|127\.0\.0\.1):\d+$")


def log(msg):
    try:
        os.makedirs(os.path.dirname(LOG), exist_ok=True)
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(time.strftime("%H:%M:%S ") + msg + "\n")
    except OSError:
        pass


class Engine:
    def __init__(self):
        self.state = "loading"
        self.message = "Loading the AI model"
        self.device = None
        self.loaded = threading.Event()
        self.lock = threading.Lock()

    def status(self):
        return {"ok": True, "ready": self.state == "ready", "state": self.state,
                "device": self.device, "message": self.message}

    def load(self):
        try:
            import numpy as np
            import torch
            import yaml
            from utils.mmdit_model_utils import resolve_mmdit_factory
            from utils.raw_joint_utils import load_raw_joint_mean_std, unflatten_raw_joints_np

            self.np, self.torch, self.unflatten = np, torch, unflatten_raw_joints_np
            with open(os.path.join(CKPT_DIR, "config.yaml"), encoding="utf-8") as f:
                saved = yaml.safe_load(f) or {}

            # The same settings MSFlow's demo uses (sample/demo_msflow_263.py with conf/demo_msflow_xyz.yaml).
            kwargs = {
                "input_dim": 22 * 3,
                "max_length": int(saved.get("max_length", 1024)),
                "is_causal": bool(saved.get("is_causal", False)),
                "num_frame_per_block": int(saved.get("num_frame_per_block", 1)),
                "use_single_token_refiner": bool(saved.get("use_single_token_refiner", True)),
                "bert_model_path": BERT_DIR,
                "noise_scale": float(saved.get("noise_scale", 5.0)),
                "flow_output_type": saved.get("flow_output_type", "x"),
                "flow_t_sampler": saved.get("flow_t_sampler", "uniform"),
                "sigma_min": 0.01,
                "sampler": "myheun2",
                "raw_joint_dim": 3,
                "raw_joint_count": 22,
                "patch_size": (1, 22),
                "stride_size": (1, 22),
            }
            factory, _ = resolve_mmdit_factory("MMDiT_xyz")
            model = factory(**kwargs)
            ckpt_path = os.path.join(CKPT_DIR, "model", "latest.tar")
            try:
                ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=True)
            except Exception:
                # The file is checked against its published SHA-256 when it is downloaded.
                ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
            missing, unexpected = model.load_state_dict(ckpt["ema_model"], strict=False)
            bad = [k for k in missing if not k.startswith("clip_model.")]
            if bad or unexpected:
                raise RuntimeError("The AI model file does not match the code (%d missing, %d unexpected keys)." % (len(bad), len(unexpected)))
            del ckpt

            self.mean, self.std = load_raw_joint_mean_std(
                "t2m",
                mean_path=os.path.join(MEAN_STD, "22x3_mean.npy"),
                std_path=os.path.join(MEAN_STD, "22x3_std.npy"),
                normalization=saved.get("raw_normalization", "shared_xyz"),
            )

            device = torch.device("cpu")
            if torch.cuda.is_available():
                try:
                    probe = torch.ones(64, 64, device="cuda")
                    (probe @ probe).sum().item()
                    device = torch.device("cuda")
                except Exception as e:  # e.g. a card this PyTorch build has no kernels for
                    log("CUDA unusable, using the CPU: %s" % e)
            torch.backends.cuda.matmul.allow_tf32 = True
            torch.backends.cudnn.allow_tf32 = True
            model.eval()
            model.to(device)
            self.model = model
            self.dev = device
            self.device = torch.cuda.get_device_name(device) if device.type == "cuda" else "CPU"
            # The first generation on a GPU pays a one-time warm-up (about 15 s); do it now so the
            # studio's first request is quick.
            self.message = "Warming up the AI"
            t0 = time.time()
            with torch.no_grad():
                model.generate(["a person stands still"], torch.tensor([MIN_FRAMES], device=device), cond_scale=CFG_SCALE)
            log("warm-up took %.1f s" % (time.time() - t0))
            self.state = "ready"
            self.message = "Ready on " + self.device
            log(self.message)
        except Exception as e:
            self.state = "error"
            self.message = "The AI model could not be loaded: %s" % e
            log(self.message + "\n" + traceback.format_exc())
        finally:
            self.loaded.set()

    def generate(self, text, seconds, seed):
        if not self.loaded.wait(timeout=900) or self.state != "ready":
            raise RuntimeError(self.message)
        np, torch = self.np, self.torch
        frames = int(round(max(MIN_FRAMES, min(MAX_FRAMES, float(seconds) * FPS))))
        with self.lock, torch.no_grad():
            torch.manual_seed(int(seed))
            np.random.seed(int(seed) % (2 ** 32))
            lengths = torch.tensor([frames], dtype=torch.long, device=self.dev)
            pred = self.model.generate([text], lengths, cond_scale=CFG_SCALE)
            if pred.ndim == 4:
                pred = pred[:, :, 0, :]
            norm = pred.detach().float().cpu().numpy()
        joints = self.unflatten(norm, joint_count=22, joint_dim=3) * self.std + self.mean
        return np.round(joints[0, :frames], 4).tolist(), frames


ENGINE = Engine()


class Handler(BaseHTTPRequestHandler):
    server_version = "StudioAI/1.0"

    def log_message(self, fmt, *args):
        pass

    def _origin_ok(self):
        origin = self.headers.get("Origin")
        return origin is None or bool(LOCAL_ORIGIN.match(origin))

    def _send(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        origin = self.headers.get("Origin")
        if origin and LOCAL_ORIGIN.match(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        if not self._origin_ok():
            return self._send(403, {"ok": False, "message": "Forbidden"})
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin"))
        self.send_header("Access-Control-Allow-Methods", "GET, POST")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path.split("?")[0] == "/api/ai/status":
            return self._send(200, ENGINE.status())
        self._send(404, {"ok": False, "message": "Unknown endpoint"})

    def do_POST(self):
        if not self._origin_ok():
            return self._send(403, {"ok": False, "message": "Forbidden"})
        if self.path.split("?")[0] != "/api/ai/generate":
            return self._send(404, {"ok": False, "message": "Unknown endpoint"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            req = json.loads(self.rfile.read(min(n, 65536)) or b"{}")
            text = str(req.get("text") or "").strip()[:400]
            if not text:
                return self._send(400, {"ok": False, "message": "Describe the motion first."})
            t0 = time.time()
            joints, frames = ENGINE.generate(text, req.get("seconds", 4), req.get("seed", int(time.time()) % 100000))
            log("generated %d frames in %.1f s: %s" % (frames, time.time() - t0, text))
            self._send(200, {"ok": True, "fps": FPS, "frames": frames, "joints": joints, "text": text})
        except Exception as e:
            log("generate failed: %s\n%s" % (e, traceback.format_exc()))
            self._send(500, {"ok": False, "message": str(e)})


def exit_with_parent(pid):
    """Stops this server when the process that started it (the Studio helper) ends."""
    SYNCHRONIZE, INFINITE = 0x00100000, 0xFFFFFFFF
    k32 = ctypes.windll.kernel32
    handle = k32.OpenProcess(SYNCHRONIZE, False, int(pid))
    if not handle:
        log("parent %s not found; exiting" % pid)
        os._exit(0)
    k32.WaitForSingleObject(handle, INFINITE)
    log("parent exited; stopping")
    os._exit(0)


def main():
    ap = argparse.ArgumentParser(description="Studio text-to-motion server (MSFlow)")
    ap.add_argument("--port", type=int, default=47920)
    ap.add_argument("--parent", type=int, default=0, help="exit when this process ends")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()

    if args.selftest:
        t0 = time.time()
        ENGINE.load()
        if ENGINE.state != "ready":
            print(json.dumps({"ok": False, "message": ENGINE.message}))
            sys.exit(1)
        load_s = time.time() - t0
        t1 = time.time()
        joints, frames = ENGINE.generate("a person waves with the right hand", 2.0, 1234)
        ok = len(joints) == frames and len(joints[0]) == 22
        print(json.dumps({"ok": ok, "device": ENGINE.device, "frames": frames,
                          "load_seconds": round(load_s, 1), "generate_seconds": round(time.time() - t1, 1),
                          "message": "" if ok else "unexpected output shape"}))
        sys.exit(0 if ok else 1)

    if args.parent:
        threading.Thread(target=exit_with_parent, args=(args.parent,), daemon=True).start()
    threading.Thread(target=ENGINE.load, daemon=True).start()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    log("listening on 127.0.0.1:%d" % args.port)
    server.serve_forever()


if __name__ == "__main__":
    main()
