// Studio: the Windows app.
//
// A native window that hosts the studio through WebView2 (the web runtime built into Windows), so
// there is no browser window, tab or address bar. It starts the local helper (bridge\server.ps1)
// without a console window, shows a splash until the studio is ready, and stops the helper when
// the window closes. Launching it again while it runs brings the open window to the front.
//
// Built by installer\build.ps1 with the C# compiler that ships with Windows (C# 5, .NET Framework 4).
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Text;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: System.Reflection.AssemblyTitle("Studio")]
[assembly: System.Reflection.AssemblyProduct("Studio")]
[assembly: System.Reflection.AssemblyDescription("Animation studio for inZOI")]
[assembly: System.Reflection.AssemblyCompany("Zoi Animation Studio")]
[assembly: System.Reflection.AssemblyVersion("1.1.2.0")]
[assembly: System.Reflection.AssemblyFileVersion("1.1.2.0")]

static class Program
{
    // Setup and Uninstall wait on this name (Inno Setup AppMutex) so files are never replaced in use.
    public const string MutexName = "ZoiMotionStudio.Running";
    public const string AppId = "ZoiAnimationFramework.ZoiMotionStudio";
    public static readonly string AppDir = AppDomain.CurrentDomain.BaseDirectory;
    public static readonly string DataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Zoi Motion Studio");
    static StreamWriter log;

    [STAThread]
    static int Main()
    {
        Directory.CreateDirectory(DataDir);
        try { log = new StreamWriter(Path.Combine(DataDir, "launcher.log"), false, Encoding.UTF8); log.AutoFlush = true; } catch { }
        Log("Studio, app folder " + AppDir);
        Native.SetCurrentProcessExplicitAppUserModelID(AppId);

        bool first;
        using (var mutex = new Mutex(true, MutexName, out first))
        {
            if (!first) { FocusRunningWindow(); return 0; }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string runtime = null;
            try { runtime = CoreWebView2Environment.GetAvailableBrowserVersionString(); } catch (Exception e) { Log("WebView2 check: " + e.Message); }
            if (string.IsNullOrEmpty(runtime))
            {
                var answer = MessageBox.Show(
                    "Studio needs the Microsoft Edge WebView2 Runtime, which is part of Windows 11.\n\nOpen Microsoft's download page now?",
                    "Studio", MessageBoxButtons.YesNo, MessageBoxIcon.Information);
                if (answer == DialogResult.Yes) OpenExternal("https://developer.microsoft.com/microsoft-edge/webview2/");
                return 1;
            }
            Log("WebView2 runtime " + runtime);
            Application.Run(new StudioWindow());
            return 0;
        }
    }

    static void FocusRunningWindow()
    {
        var me = Process.GetCurrentProcess();
        foreach (var p in Process.GetProcessesByName(me.ProcessName))
        {
            if (p.Id == me.Id || p.MainWindowHandle == IntPtr.Zero) continue;
            if (Native.IsIconic(p.MainWindowHandle)) Native.ShowWindow(p.MainWindowHandle, 9); // SW_RESTORE
            Native.SetForegroundWindow(p.MainWindowHandle);
            return;
        }
    }

    public static void OpenExternal(string url)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch (Exception e) { Log("open " + url + ": " + e.Message); }
    }

    public static void Log(string line)
    {
        if (log == null) return;
        try { lock (log) log.WriteLine(DateTime.Now.ToString("HH:mm:ss.fff") + "  " + line); } catch { }
    }
}

sealed class StudioWindow : Form
{
    static readonly Color Back = Color.FromArgb(0x11, 0x12, 0x15);
    static readonly Color Text1 = Color.FromArgb(0xF1, 0xED, 0xF4);
    static readonly Color Muted = Color.FromArgb(0x9A, 0x9C, 0xA4);
    static readonly Color Teal = Color.FromArgb(0x3C, 0xDA, 0xC1);

    readonly WebView2 web = new WebView2();
    readonly Splash splash = new Splash();
    Process helper;
    int port;
    string origin;
    readonly StringBuilder helperErrors = new StringBuilder();

    public StudioWindow()
    {
        Text = "Studio";
        BackColor = Back;
        MinimumSize = new Size(960, 600);
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        StartPosition = FormStartPosition.Manual;
        RestorePlacement();

        web.Dock = DockStyle.Fill;
        web.DefaultBackgroundColor = Back;
        splash.Dock = DockStyle.Fill;
        Controls.Add(splash);
        Controls.Add(web);
        splash.BringToFront();
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        // Dark title bar in the studio's colours (Windows 11; Windows 10 just uses dark mode).
        int on = 1;
        Native.DwmSetWindowAttribute(Handle, 20, ref on, 4);           // DWMWA_USE_IMMERSIVE_DARK_MODE
        int caption = Back.R | (Back.G << 8) | (Back.B << 16);
        Native.DwmSetWindowAttribute(Handle, 35, ref caption, 4);      // DWMWA_CAPTION_COLOR
        int text = Text1.R | (Text1.G << 8) | (Text1.B << 16);
        Native.DwmSetWindowAttribute(Handle, 36, ref text, 4);         // DWMWA_TEXT_COLOR
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        try
        {
            var start = StartHelperAsync();
            // The studio's saved work (autosave, preferences, My poses) lives in this profile.
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Program.DataDir, "WebView2"),
                new CoreWebView2EnvironmentOptions("--disable-features=Translate"));
            await web.EnsureCoreWebView2Async(env);
            ConfigureWebView();
            if (!await start) return;
            origin = "http://localhost:" + port;
            web.CoreWebView2.Navigate(origin + "/");
        }
        catch (Exception ex)
        {
            Program.Log("Startup failed: " + ex);
            splash.ShowError("Studio could not start.\n" + ex.Message + "\n\nDetails: " + Path.Combine(Program.DataDir, "launcher.log"));
        }
    }

    void ConfigureWebView()
    {
        var core = web.CoreWebView2;
        var s = core.Settings;
        // An app, not a browser: no browser shortcuts (reload, find, print), zoom, swipe or autofill.
        s.AreBrowserAcceleratorKeysEnabled = false;
        s.IsZoomControlEnabled = false;
        s.IsPinchZoomEnabled = false;
        s.IsSwipeNavigationEnabled = false;
        s.IsStatusBarEnabled = false;
        s.IsGeneralAutofillEnabled = false;
        s.IsPasswordAutosaveEnabled = false;
        s.AreDevToolsEnabled = Environment.GetEnvironmentVariable("ZMS_DEVTOOLS") == "1";

        core.DocumentTitleChanged += delegate { if (!string.IsNullOrEmpty(core.DocumentTitle)) Text = core.DocumentTitle; };
        core.NavigationCompleted += (o, a) =>
        {
            if (a.IsSuccess) splash.Visible = false;
            else splash.ShowError("The studio page did not load (" + a.WebErrorStatus + ").");
        };
        // Links to websites open in the normal browser; the app window only shows the studio.
        core.NewWindowRequested += (o, a) => { a.Handled = true; Program.OpenExternal(a.Uri); };
        core.NavigationStarting += (o, a) =>
        {
            if (origin != null && !a.Uri.StartsWith(origin + "/", StringComparison.OrdinalIgnoreCase) && !a.Uri.StartsWith("about:", StringComparison.OrdinalIgnoreCase))
            {
                a.Cancel = true;
                Program.OpenExternal(a.Uri);
            }
        };
        // "Act it out" records from the webcam: allowed for the studio itself, nothing else.
        core.PermissionRequested += (o, a) =>
        {
            if (origin != null && a.Uri.StartsWith(origin, StringComparison.OrdinalIgnoreCase) &&
                (a.PermissionKind == CoreWebView2PermissionKind.Camera || a.PermissionKind == CoreWebView2PermissionKind.ClipboardRead))
                a.State = CoreWebView2PermissionState.Allow;
        };
        // Right-click: the studio has its own menus; text fields keep cut / copy / paste.
        core.ContextMenuRequested += (o, a) =>
        {
            var keep = new[] { "cut", "copy", "paste", "pasteAndMatchStyle", "selectAll", "undo", "redo" };
            var items = a.MenuItems;
            for (int i = items.Count - 1; i >= 0; i--)
                if (Array.IndexOf(keep, items[i].Name) < 0) items.RemoveAt(i);
            if (items.Count == 0) a.Handled = true;
        };
        core.ProcessFailed += (o, a) =>
        {
            Program.Log("WebView2 process failed: " + a.ProcessFailedKind);
            if (a.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited || a.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)
                BeginInvoke((Action)(() => { try { web.CoreWebView2.Reload(); } catch { } }));
        };
    }

    // ------------------------------------------------------------------ helper process

    Task<bool> StartHelperAsync()
    {
        string script = Path.Combine(Program.AppDir, @"bridge\server.ps1");
        if (!File.Exists(script))
        {
            splash.ShowError("The studio files are missing (" + script + ").\nPlease reinstall Studio.");
            return Task.FromResult(false);
        }
        var psi = new ProcessStartInfo("powershell.exe",
            "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + script + "\" -NoBrowser");
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.WorkingDirectory = Program.AppDir;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.StandardOutputEncoding = Encoding.UTF8;

        var ready = new TaskCompletionSource<bool>();
        try { helper = Process.Start(psi); }
        catch (Exception e)
        {
            splash.ShowError("Could not start the studio helper (Windows PowerShell).\n" + e.Message);
            return Task.FromResult(false);
        }
        helper.OutputDataReceived += (o, e) =>
        {
            if (e.Data == null) return;
            Program.Log("helper: " + e.Data);
            var m = Regex.Match(e.Data, @"Running at http://localhost:(\d+)/");
            if (m.Success) { port = int.Parse(m.Groups[1].Value); ready.TrySetResult(true); }
        };
        helper.ErrorDataReceived += (o, e) =>
        {
            if (e.Data == null) return;
            Program.Log("helper error: " + e.Data);
            lock (helperErrors) helperErrors.AppendLine(e.Data);
        };
        helper.EnableRaisingEvents = true;
        helper.Exited += (o, e) => ready.TrySetResult(false);
        helper.BeginOutputReadLine();
        helper.BeginErrorReadLine();

        return Task.Run(() =>
        {
            bool ok = ready.Task.Wait(30000) && ready.Task.Result;
            if (ok) { WaitForStatus(port, 10000); Program.Log("Helper ready on port " + port); return true; }
            string detail;
            lock (helperErrors) detail = helperErrors.ToString().Trim();
            if (detail.Length > 500) detail = detail.Substring(0, 500) + "...";
            BeginInvoke((Action)(() => splash.ShowError("The studio helper did not start." + (detail.Length > 0 ? "\n\n" + detail : "") +
                "\n\nDetails: " + Path.Combine(Program.DataDir, "launcher.log"))));
            return false;
        });
    }

    static void WaitForStatus(int p, int ms)
    {
        var clock = Stopwatch.StartNew();
        while (clock.ElapsedMilliseconds < ms)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + p + "/api/status");
                req.Timeout = 1000; req.Proxy = null;
                using (req.GetResponse()) return;
            }
            catch { Thread.Sleep(150); }
        }
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        SavePlacement();
        base.OnFormClosing(e);
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        try { web.Dispose(); } catch { }
        try { if (helper != null && !helper.HasExited) { helper.Kill(); helper.WaitForExit(3000); } } catch { }
        Program.Log("Closed");
        base.OnFormClosed(e);
    }

    // ------------------------------------------------------------------ window placement

    string PlacementFile { get { return Path.Combine(Program.DataDir, "window.txt"); } }

    void RestorePlacement()
    {
        var area = Screen.PrimaryScreen.WorkingArea;
        Bounds = new Rectangle(area.X + area.Width / 12, area.Y + area.Height / 12, area.Width * 5 / 6, area.Height * 5 / 6);
        WindowState = FormWindowState.Maximized;
        try
        {
            var p = File.ReadAllText(PlacementFile).Split(' ');
            var r = new Rectangle(int.Parse(p[0]), int.Parse(p[1]), int.Parse(p[2]), int.Parse(p[3]));
            foreach (var s in Screen.AllScreens)
                if (s.WorkingArea.IntersectsWith(r)) { Bounds = r; WindowState = p[4] == "1" ? FormWindowState.Maximized : FormWindowState.Normal; break; }
        }
        catch { }
    }

    void SavePlacement()
    {
        try
        {
            var r = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            File.WriteAllText(PlacementFile, r.X + " " + r.Y + " " + r.Width + " " + r.Height + " " + (WindowState == FormWindowState.Maximized ? "1" : "0"));
        }
        catch { }
    }

    // ------------------------------------------------------------------ splash

    sealed class Splash : Control
    {
        string error;
        readonly System.Windows.Forms.Timer tick = new System.Windows.Forms.Timer();
        float phase;
        // The brand: wireframe head and STUDIO wordmark (white on transparent, from studio\assets).
        readonly Image mark = LoadImage("logo-mark.png");
        readonly Image word = LoadImage("wordmark.png");

        static Image LoadImage(string name)
        {
            try { return Image.FromFile(Path.Combine(Program.AppDir, @"studio\assets\" + name)); } catch { return null; }
        }

        public Splash()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
            BackColor = Back;
            tick.Interval = 16;
            tick.Tick += delegate { phase = (phase + 0.012f) % 1f; Invalidate(); };
            tick.Start();
        }

        public void ShowError(string message) { error = message; tick.Stop(); Visible = true; BringToFront(); Invalidate(); }

        protected override void OnVisibleChanged(EventArgs e) { base.OnVisibleChanged(e); if (!Visible) tick.Stop(); }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            g.Clear(Back);
            float dpi = DeviceDpi / 96f;
            int cx = Width / 2, cy = Height / 2;
            using (var title = new Font("Segoe UI Variable Display", 22f, FontStyle.Bold))
            using (var sub = new Font("Segoe UI Variable Text", 10.5f))
            using (var tb = new SolidBrush(Text1))
            using (var mb = new SolidBrush(Muted))
            {
                var fmt = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
                if (mark != null && word != null)
                {
                    // Head and wordmark side by side, like the studio's top bar, centred above the bar.
                    g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                    float mh = 84 * dpi, wh = 34 * dpi, ww = wh * word.Width / word.Height, gap = 14 * dpi;
                    float left = cx - (mh + gap + ww) / 2, top = cy - 24 * dpi - mh;
                    g.DrawImage(mark, left, top, mh, mh);
                    g.DrawImage(word, left + mh + gap, top + (mh - wh) / 2, ww, wh);
                }
                else g.DrawString("Studio", title, tb, new RectangleF(0, cy - 60 * dpi, Width, 50 * dpi), fmt);
                if (error == null)
                {
                    // A thin teal bar sweeping under the title while the studio starts.
                    float w = 220 * dpi, x0 = cx - w / 2, y = cy + 4 * dpi;
                    using (var track = new SolidBrush(Color.FromArgb(0x2B, 0x2D, 0x33))) g.FillRectangle(track, x0, y, w, 3 * dpi);
                    float seg = w * 0.32f, x = x0 + (w + seg) * phase - seg;
                    float a = Math.Max(x, x0), b = Math.Min(x + seg, x0 + w);
                    if (b > a) using (var bar = new SolidBrush(Teal)) g.FillRectangle(bar, a, y, b - a, 3 * dpi);
                    g.DrawString("Starting the studio", sub, mb, new RectangleF(0, y + 14 * dpi, Width, 24 * dpi), fmt);
                }
                else
                {
                    g.DrawString(error, sub, mb, new RectangleF(Width * 0.15f, cy, Width * 0.7f, Height / 2f - 20 * dpi),
                        new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Near });
                }
            }
        }
    }
}

static class Native
{
    [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] public static extern int SetCurrentProcessExplicitAppUserModelID(string id);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
}
