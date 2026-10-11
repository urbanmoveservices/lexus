using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
class Launcher {
 [STAThread] static void Main() {
  string root=AppDomain.CurrentDomain.BaseDirectory;
  try { var info=new ProcessStartInfo(Path.Combine(root,"runtime","node.exe"),"\""+Path.Combine(root,"launch.cjs")+"\"");info.WorkingDirectory=root;info.UseShellExecute=false;info.CreateNoWindow=true;var process=Process.Start(info);process.WaitForExit();if(process.ExitCode!=0)MessageBox.Show("LEXUS could not start. Check the internet connection and desktop.stderr.log in the installation folder.","LEXUS"); }
  catch(Exception e){MessageBox.Show(e.Message,"LEXUS");}
 }
}
