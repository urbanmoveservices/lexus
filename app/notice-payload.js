const defaults = {enabled:true,title:'LEXUS notice board',message:'Updates install only when you click Update LEXUS. Read the guidance below before booking.',recommended:'For a QR payment, choose PhonePe QR or Paytm QR.',avoid:'Razorpay UPI ID uses collect approval in your UPI app; it does not show a QR.'};
function validateNotice(input) {
 const result={enabled:input.enabled===true};
 for(const [key,max] of [['title',120],['message',4000],['recommended',2000],['avoid',2000]]) {
  if(typeof input[key]!=='string'||input[key].length>max)throw Error('Invalid notice '+key);
  result[key]=input[key].trim();
 }
 if(result.enabled&&!result.title)throw Error('Notice title is required');
 return result;
}
function noticeNews(notice, release, current) {
 const items=[];
 if(notice?.enabled) {
  items.push(notice.title,notice.message);
  if(notice.recommended)items.push('Recommended: '+notice.recommended);
  if(notice.avoid)items.push('Avoid: '+notice.avoid);
 }
 if(release?.version&&release.version!==current)items.push('Installed version: '+current+'. Latest release: '+release.version+'. Click Update LEXUS to check and install.');
 return {items:items.filter(Boolean)};
}
module.exports={defaults,validateNotice,noticeNews};
