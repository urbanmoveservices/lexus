using System;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Windows.Forms;
static class InstallerTheme {
 public static void Apply(Form form,Label status,Button action,ProgressBar progress) {
  var blue=Color.FromArgb(36,88,196);var pale=Color.FromArgb(237,244,255);var ink=Color.FromArgb(24,48,78);
  form.ClientSize=new Size(620,430);form.Font=new Font("Segoe UI",10);form.BackColor=Color.White;form.AutoScaleMode=AutoScaleMode.None;
  using(var s=Assembly.GetExecutingAssembly().GetManifestResourceStream("lexus.icon")){if(s!=null)form.Icon=new Icon(s);}
  var top=new Panel{BackColor=pale,Location=new Point(0,0),Size=new Size(620,158)};form.Controls.Add(top);top.SendToBack();
  using(var s=Assembly.GetExecutingAssembly().GetManifestResourceStream("lexus.logo")){var logo=new PictureBox{Image=new Bitmap(Image.FromStream(s)),SizeMode=PictureBoxSizeMode.Zoom,Location=new Point(28,20),Size=new Size(124,124),BackColor=Color.White};form.Controls.Add(logo);}
  foreach(Control c in form.Controls){if(c is Label&&c!=status){if(c.Top<50){c.SetBounds(178,35,420,42);c.Font=new Font("Segoe UI",23,FontStyle.Bold);c.ForeColor=ink;c.BackColor=pale;}else if(c.Top<140){c.SetBounds(36,184,548,76);c.Font=new Font("Segoe UI",10);c.ForeColor=Color.FromArgb(76,96,118);}}}
  form.Controls.Add(new Label{Text="LEXUS  /  WINDOWS 64-BIT",Location=new Point(181,89),Size=new Size(390,25),Font=new Font("Segoe UI",9,FontStyle.Bold),ForeColor=blue,BackColor=pale});
  status.SetBounds(36,274,548,26);status.ForeColor=ink;status.Font=new Font("Segoe UI",10,FontStyle.Bold);
  progress.SetBounds(36,307,548,12);
  action.SetBounds(340,339,244,43);action.FlatStyle=FlatStyle.Flat;action.FlatAppearance.BorderSize=0;action.BackColor=blue;action.ForeColor=Color.White;action.Font=new Font("Segoe UI",11,FontStyle.Bold);action.Cursor=Cursors.Hand;
  form.Controls.Add(new Label{Text="lexus.vaidya-gpt.com  •  Your key. Your workspace.",Location=new Point(36,394),Size=new Size(550,22),Font=new Font("Segoe UI",9),ForeColor=Color.FromArgb(91,111,131)});
 }
 public static void Preview(Form form,string file){form.CreateControl();using(var bitmap=new Bitmap(form.Width,form.Height)){form.DrawToBitmap(bitmap,new Rectangle(0,0,bitmap.Width,bitmap.Height));bitmap.Save(file,System.Drawing.Imaging.ImageFormat.Png);}}
}

