"""VMC / OSC packet monitor for testing the Studio live link.

Usage:  python vmc_monitor.py [port] [seconds]
Listens on UDP (default 39540 so it never clashes with inZOI on 39539), decodes OSC
messages and bundles, and prints a summary of what was received.
"""
import socket
import struct
import sys
import time


def read_str(data, o):
    end = data.index(b'\0', o)
    s = data[o:end].decode('utf-8', 'replace')
    return s, (end + 4) & ~3


def parse_message(data):
    addr, o = read_str(data, 0)
    tags, o = read_str(data, o)
    args = []
    for t in tags[1:]:
        if t == 'f':
            args.append(struct.unpack('>f', data[o:o + 4])[0]); o += 4
        elif t == 'i':
            args.append(struct.unpack('>i', data[o:o + 4])[0]); o += 4
        elif t == 's':
            s, o = read_str(data, o); args.append(s)
    return addr, args


def parse_packet(data, out):
    if data.startswith(b'#bundle\0'):
        o = 16
        while o < len(data):
            size = struct.unpack('>i', data[o:o + 4])[0]
            parse_packet(data[o + 4:o + 4 + size], out)
            o += 4 + size
    else:
        out.append(parse_message(data))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 39540
    seconds = float(sys.argv[2]) if len(sys.argv) > 2 else 10
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(('127.0.0.1', port))
    sock.settimeout(0.5)
    print(f'Listening on 127.0.0.1:{port} for {seconds:.0f}s ...', flush=True)
    end = time.time() + seconds
    packets, last = 0, []
    bones = set()
    while time.time() < end:
        try:
            data, _ = sock.recvfrom(65535)
        except socket.timeout:
            continue
        packets += 1
        msgs = []
        parse_packet(data, msgs)
        if any(a == '/VMC/Ext/Bone/Pos' for a, _ in msgs):
            last = msgs
        for a, args in msgs:
            if a == '/VMC/Ext/Bone/Pos':
                bones.add(args[0])
    print(f'packets: {packets}')
    print(f'distinct bones: {len(bones)}')
    for a, args in last:
        if a == '/VMC/Ext/Bone/Pos' and args[0] in ('Hips', 'Chest', 'LeftUpperArm', 'RightLowerLeg', 'Head', 'LeftIndexProximal'):
            print(f'  {args[0]:18s} pos=({args[1]:+.3f},{args[2]:+.3f},{args[3]:+.3f}) rot=({args[4]:+.3f},{args[5]:+.3f},{args[6]:+.3f},{args[7]:+.3f})')
    other = sorted({a for a, _ in last if a != '/VMC/Ext/Bone/Pos'})
    print('other addresses:', other)


if __name__ == '__main__':
    main()
