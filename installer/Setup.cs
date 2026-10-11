using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Diagnostics;
using System.Drawing;
using System.Threading.Tasks;
using System.Windows.Forms;
class Setup : Form {
 readonly string target=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Programs","LEXUS");
 bool installedDone=false; Label status=new Label(); Button install=new Button(); ProgressBar progress=new ProgressBar();
 Setup(){Text="LEXUS Setup";ClientSize=new Size(520,250);FormBorderStyle=FormBorderStyle.FixedDialog;MaximizeBox=false;StartPosition=FormStartPosition.CenterScreen;BackColor=Color.White;
 var title=new Label{Text="Install LEXUS",Font=new Font("Segoe UI",20,FontStyle.Bold),Location=new Point(24,20),Size=new Size(460,40)};Controls.Add(title);
 var detail=new Label{Text="Windows 10/11 (64-bit)\nIncludes app runtime, dependencies and Chrome for WEB-2.\nActivation uses lexus.vaidya-gpt.com. Internet is required.",Location=new Point(24,70),Size=new Size(470,66)};Controls.Add(detail);
 status.SetBounds(24,143,470,30);status.Text="Install or update for your Windows account.";Controls.Add(status);progress.SetBounds(24,177,470,16);Controls.Add(progress);
 install.Text="Install / Update";install.SetBounds(335,205,160,30);Controls.Add(install);install.Click+=async(s,e)=>{if(installedDone){Process.Start(Path.Combine(target,"LEXUS.exe"));Close();return;}install.Enabled=false;try{if(!Environment.Is64BitOperatingSystem)throw new Exception("64-bit Windows is required.");EnsureClosed(target);status.Text="Installing...";progress.Style=ProgressBarStyle.Marquee;await Task.Run(()=>{Extract(target);Integrate(target);});progress.Style=ProgressBarStyle.Blocks;progress.Value=100;status.Text="Installation complete. Desktop shortcut created.";install.Text="Open LEXUS";install.Enabled=true;installedDone=true;}catch(Exception error){status.Text="Installation failed";MessageBox.Show(error.Message,"LEXUS Setup");install.Enabled=true;}};
 }
 static void EnsureClosed(string root){foreach(var p in Process.GetProcessesByName("electron")){try{if(p.MainModule.FileName.StartsWith(root+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("Close the installed LEXUS before updating.");}catch(System.ComponentModel.Win32Exception){}}}
 static void Extract(string root){Directory.CreateDirectory(root);root=Path.GetFullPath(root)+Path.DirectorySeparatorChar;using(var resource=Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))using(var zip=new ZipArchive(resource,ZipArchiveMode.Read)){foreach(var entry in zip.Entries){string file=Path.GetFullPath(Path.Combine(root,entry.FullName));if(!file.StartsWith(root,StringComparison.OrdinalIgnoreCase))throw new Exception("Invalid package path");if(entry.FullName.EndsWith("/")){Directory.CreateDirectory(file);continue;}Directory.CreateDirectory(Path.GetDirectoryName(file));using(var input=entry.Open())using(var output=File.Create(file))input.CopyTo(output);}}}
 static void Integrate(string root){var info=new ProcessStartInfo("powershell.exe","-NoProfile -ExecutionPolicy Bypass -File \""+Path.Combine(root,"install-integration.ps1")+"\"");info.UseShellExecute=false;info.CreateNoWindow=true;using(var p=Process.Start(info)){p.WaitForExit();if(p.ExitCode!=0)throw new Exception("Shortcut registration failed. Launch LEXUS.exe from the installation folder.");}}
 [STAThread] static int Main(string[] args){if(args.Length==2&&args[0]=="/extract"){string dest=Path.GetFullPath(args[1]);if(!dest.StartsWith(Path.GetTempPath(),StringComparison.OrdinalIgnoreCase))return 2;try{Extract(dest);return 0;}catch{return 1;}}Application.EnableVisualStyles();Application.Run(new Setup());return 0;}
}

