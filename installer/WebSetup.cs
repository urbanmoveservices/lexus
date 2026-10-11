using System;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Diagnostics;
using System.Drawing;
using System.Threading.Tasks;
using System.Windows.Forms;
class WebSetup:Form {
 const string Url="__OFFLINE_URL__", ExpectedHash="__OFFLINE_SHA256__";
 readonly Label status=new Label();readonly ProgressBar progress=new ProgressBar();readonly Button button=new Button();WebClient client;bool busy=false;
 WebSetup(){Text="LEXUS Web Setup";ClientSize=new Size(520,245);FormBorderStyle=FormBorderStyle.FixedDialog;MaximizeBox=false;StartPosition=FormStartPosition.CenterScreen;BackColor=Color.White;
 Controls.Add(new Label{Text="Install LEXUS",Font=new Font("Segoe UI",20,FontStyle.Bold),Location=new Point(24,20),Size=new Size(470,40)});
 Controls.Add(new Label{Text="Downloads the full LEXUS package (about 529 MB).\nIncludes app runtime, dependencies and Chrome for WEB-2.\nKeep your internet connection active during setup.",Location=new Point(24,70),Size=new Size(470,65)});
 status.SetBounds(24,140,470,28);status.Text="Ready to download and verify.";Controls.Add(status);progress.SetBounds(24,174,470,18);Controls.Add(progress);button.Text="Download & Install";button.SetBounds(330,202,165,30);Controls.Add(button);button.Click+=async(s,e)=>await Download();FormClosing+=(s,e)=>{if(busy){e.Cancel=true;MessageBox.Show("Wait for the download, or close after it fails.","LEXUS Setup");}};
 }
 static bool Verify(string file){using(var input=File.OpenRead(file))using(var sha=SHA256.Create()){return BitConverter.ToString(sha.ComputeHash(input)).Replace("-","").ToLowerInvariant()==ExpectedHash;}}
 async Task Download(){busy=true;button.Enabled=false;string folder=Path.Combine(Path.GetTempPath(),"LEXUS-WebSetup-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(folder);string file=Path.Combine(folder,"LEXUS-Offline-Setup.exe");
 try{ServicePointManager.SecurityProtocol=SecurityProtocolType.Tls12;using(client=new WebClient()){client.DownloadProgressChanged+=(s,e)=>{progress.Value=e.ProgressPercentage;status.Text=String.Format("Downloading {0:F1} / {1:F1} MB",e.BytesReceived/1048576.0,e.TotalBytesToReceive/1048576.0);};await client.DownloadFileTaskAsync(new Uri(Url),file);}status.Text="Verifying package...";if(!await Task.Run(()=>Verify(file)))throw new Exception("Package verification failed. Please download again.");status.Text="Opening installer...";Process.Start(file);busy=false;Close();}
 catch(Exception error){status.Text="Download failed. You can try again.";MessageBox.Show(error.Message,"LEXUS Setup");if(File.Exists(file))File.Delete(file);busy=false;button.Enabled=true;}
 }
 [STAThread] static int Main(string[] args){if(args.Length==2&&args[0]=="/verify")return Verify(args[1])?0:1;Application.EnableVisualStyles();Application.Run(new WebSetup());return 0;}
}
