/**
 * LEXUS ticket PDF — STAR-style ERS from bookingResponseDTO / bookingData JSON.
 * Direct API + APP only. Uses Electron printToPDF → Desktop/lexus print/
 */
const { BrowserWindow, app } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { firstDto } = require('./booking-history');
const { LOGO_IRCTC, LOGO_ARROW, LOGO_RAILWAY } = require('./ticket-print-logos');

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatCleanDate(dateStr) {
  try {
    const d = String(dateStr || '').split('T')[0];
    const dt = new Date(`${d}T00:00:00`);
    if (Number.isNaN(dt.getTime())) return String(dateStr || '');
    return dt.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).replace(/ /g, '-');
  } catch {
    return String(dateStr || '');
  }
}

function formatBookingDate(dateStr) {
  try {
    const clean = String(dateStr || '').split('.')[0].replace('T', ' ');
    const dt = new Date(clean.replace(' ', 'T'));
    if (Number.isNaN(dt.getTime())) return String(dateStr || '');
    const date = dt.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).replace(/ /g, '-');
    const time = dt.toLocaleTimeString('en-GB', { hour12: false });
    return `${date} ${time} HRS`;
  } catch {
    return String(dateStr || '');
  }
}

function extractFromQr(qrText, key) {
  try {
    const m = String(qrText || '').match(new RegExp(`${key}:([^,\\n]+)`, 'i'));
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

function money(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return String(n ?? '0');
  return x.toFixed(2);
}

function fetchBuffer(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const lib = String(url).startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        fetchBuffer(res.headers.location, timeoutMs).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

async function generateQrBase64(qrText) {
  if (!qrText) return '';
  try {
    try {
      const QRCode = require('qrcode');
      return await QRCode.toDataURL(String(qrText), {
        margin: 2,
        width: 300,
        errorCorrectionLevel: 'M',
      });
    } catch (_) {
      /* optional dep */
    }
    const url = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=8&data=${encodeURIComponent(
      String(qrText)
    )}`;
    const buf = await fetchBuffer(url);
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch (e) {
    console.warn('[LEXUS Print] QR failed', e?.message || e);
    return '';
  }
}

function getDesktopPrintFolder() {
  let desktop = '';
  try {
    desktop = app.getPath('desktop');
  } catch {
    desktop = path.join(process.env.USERPROFILE || process.env.HOME || '.', 'Desktop');
  }
  const folder = path.join(desktop, 'lexus print');
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

function mapJourneyData(fullApiResponse, qrBase64) {
  const ticket = firstDto(fullApiResponse) || {};
  const pnrNo = String(ticket.pnrNumber || 'UNKNOWN').trim();
  const qrText = String(ticket.qrCodeText || '').trim();
  const fromStn = String(ticket.fromStn || 'SRC').trim();
  const toStn = String(ticket.destStn || 'DEST').trim();
  const fullClass =
    extractFromQr(qrText, 'Class') || String(ticket.journeyClass || '').trim();
  const fullQuota =
    extractFromQr(qrText, 'Quota') ||
    `${ticket.bookedQuota || ticket.journeyQuota || ''}`.trim();

  const passengers = (ticket.psgnDtlList || []).map((p) => ({
    name: p.passengerName || '',
    age: p.passengerAge || '',
    gender: p.passengerGender || '',
    bookingStatus: p.bookingStatusDetails || '',
    currentStatus: p.currentStatusDetails || '',
  }));

  return {
    source_station: `${ticket.fromStnName || ''} (${fromStn})`.trim(),
    boarding_station: `${ticket.boardingStnName || ticket.fromStnName || ''} (${
      ticket.boardingStn || fromStn
    })`.trim(),
    dest_station: `${ticket.resvnUptoStnName || ''} (${toStn})`.trim(),
    start_date: formatCleanDate(ticket.boardingDate || ticket.journeyDate),
    dep_time: `${ticket.departureTime || ''} ${formatCleanDate(
      ticket.boardingDate || ticket.journeyDate
    )}`.trim(),
    arr_time: `${ticket.arrivalTime || ''} ${formatCleanDate(
      ticket.destArrvDate
    )}`.trim(),
    pnr: pnrNo,
    train_info: `${ticket.trainNumber || ''} / ${ticket.trainName || ''}`.trim(),
    travel_class: fullClass,
    quota: fullQuota,
    distance: String(ticket.distance || ''),
    booking_date: formatBookingDate(
      ticket.bookingDate || fullApiResponse.bookingDate || ''
    ),
    transaction_id: String(
      fullApiResponse.transactionId || ticket.clientTransactionId || ''
    ),
    ticket_fare: money(ticket.totalFare),
    conv_fee: money(ticket.serviceChargeTotal),
    ins_fee: money(ticket.insuranceCharge),
    total_fare: money(
      fullApiResponse.totalCollectibleAmount ?? ticket.totalCollectibleAmount
    ),
    invoice_no: `PS${pnrNo}11`,
    supplier_gstin: '07AAAGM0289C1ZL',
    place_of_supply:
      String(
        ticket.placeOfSupply ||
          ticket.gstPlaceOfSupply ||
          ticket.gstStateName ||
          ''
      ).trim() || 'NA',
    supplier_state: String(ticket.supplierStateName || ticket.supplierState || '').trim() || '/',
    qr_code_base64: qrBase64 || '',
    passengers,
    fromStn,
    toStn,
  };
}

/** Original IRCTC ERS static footer (disclaimers + INSTRUCTIONS 1–16 + Customer Care). */
function buildErsStaticFooter(data) {
  const place = esc(data.place_of_supply || 'NA');
  const supplierState = esc(data.supplier_state || '/');
  const instr = (n, text) => `
        <tr>
          <td valign="top" style="text-align:justify;padding:0;"><span style="font-size:11px;">${n}.</span></td>
          <td valign="top" style="text-align:justify;padding:0 0 0 5px;"><span style="font-size:11px;">${text}</span></td>
        </tr>`;
  return `
    <tr>
      <td>
        <ul style="list-style-type:disc;padding:0 25px;margin-bottom:5px;">
          <li style="font-size:13px;padding-top:5px;text-align:justify;">
            <strong>Beware of fraudulent customer care number. For any assistance, use only the IRCTC e-ticketing Customer care number:14646.</strong>
          </li>
        </ul>
      </td>
    </tr>
    <tr>
      <td style="border-bottom:1px solid #000;">
        <ul style="list-style-type:none;margin:0;padding:0 10px;">
          <li style="font-size:12px;text-align:justify;padding-left:1px;">
            <strong>IRCTC Convenience Fee is charged per e-ticket irrespective of number of passengers on the ticket.</strong>
          </li>
          <li style="font-size:13px;padding:3px 0;">
            <strong>* The printed Departure and Arrival Times are liable to change. Please Check correct departure, arrival from Railway Station Enquiry or Dial 139 or SMS RAIL to 139.</strong>
          </li>
        </ul>
      </td>
    </tr>
    <tr>
      <td>
        <ul style="list-style-type:disc;padding:0 25px;margin-bottom:5px;">
          <li style="font-size:13px;padding-top:5px;text-align:justify;">
            This ticket is booked on a personal User ID, its sale/purchase is an offence u/s 143 of the Railways Act,1989.
          </li>
          <li style="font-size:13px;padding:0;text-align:justify;">
            Prescribed original ID proof is required while travelling along with SMS/ VRM/ ERS otherwise will be treated as without ticket and penalized as per Railway Rules.
          </li>
        </ul>
      </td>
    </tr>
    <tr><td colspan="12" align="center" style="border-bottom:1px solid #000;border-top:1px solid #000;"></td></tr>
    <tr style="border-bottom:2px solid #000;">
      <td style="padding:0 12px;font-size:12px;border-bottom:2px solid #000;">
        <strong>Place of Supply:</strong>&nbsp;&nbsp;${place}&nbsp;&nbsp;&nbsp;
        <strong>State Name/Code of Supplier:</strong>&nbsp;&nbsp;${supplierState}
      </td>
    </tr>
    <tr height="10"></tr>
    <tr>
      <td style="padding:0 10px;">
        <table width="100%">
          <tr><td><strong style="font-size:11px;"><u>INSTRUCTIONS:</u></strong></td></tr>
          <tr><td>
            <table border="0" width="100%" align="center" style="font-size:11px;">
              ${instr(
                1,
                'Prescribed Original ID proofs are:- Voter Identity Card / Passport / PAN Card / Driving License / Photo ID card issued by Central / State Govt. / Public Sector Undertakings of State / Central Government ,District Administrations , Municipal bodies and Panchayat Administrations which are having serial number / Student Identity Card with photograph issued by recognized School or College for their students / Nationalized Bank Passbook with photograph /Credit Cards issued by Banks with laminated photograph/Unique Identification Card "Aadhaar", m-Aadhaar, e-Aadhaar. /Passenger showing the Aadhaar/Driving Licence from the "Issued Document" section by logging into his/her DigiLocker account considered as valid proof of identity. (Documents uploaded by the user i.e. the document in "Uploaded Document" section will not be considered as a valid proof of identity).'
              )}
              ${instr(
                2,
                'PNRs having fully waitlisted status will be dropped and automatic refund of the ticket amount after deducting the applicable CLERKAGE by Railway shall be credited to the account used for payment for booking of the ticket. Passengers having fully waitlisted e-ticket are not allowed to board the train. However, the names of PARTIALLY waitlisted/confirmed and RAC ticket passenger will appear in the chart.'
              )}
              ${instr(
                3,
                'A clerkage charge of Rs.60 per passenger plus GST for AC Classes and Rs.60 per passenger for Non AC classes will be deducted if the ticket remains Waitlisted at the time of Cancellation/Charting.'
              )}
              ${instr(
                4,
                'Passengers travelling on a fully waitlisted e-ticket will be treated as Ticketless.'
              )}
              ${instr(
                5,
                'Obtain certificate from the TTE /Conductor in case of (a) PARTIALLY waitlisted e-ticket when LESS NO. OF PASSENGERS travel, (b)A.C FAILURE, (c)TRAVEL IN LOWER CLASS. This original certificate must be sent to GGM (IT), IRCTC, Internet Ticketing Centre, 2nd Floor, Tower-D, World Trade Centre, Nauroji Nagar, New Delhi- 110029, after filing TDR online within prescribed time for claiming refund.'
              )}
              ${instr(
                6,
                'In case, on a party e-ticket or a family e-ticket issued for travel of more than one passenger, some passengers have confirmed reservation and others are on RAC or waiting list, full refund of fare, less clerkage, shall be admissible for confirmed passengers also subject to the condition that the ticket shall be cancelled online or online TDR shall be filed for all the passengers upto thirty minutes before the scheduled departure of the train.'
              )}
              ${instr(
                7,
                'In case train is late more than 3 hours, refund is admissible as per railway refund rules only when TDR is filed by the user before the actual departure of the train at boarding station and passenger has not travelled.'
              )}
              ${instr(
                8,
                'In case of train cancellation on its entire run, full refund is granted automatically by the system. However, if the train is cancelled partially on its run or diverted and not touching boarding/destination station, passengers are required to file online TDR within 72 hours of scheduled departure of the train from passengers boarding station.'
              )}
              ${instr(
                9,
                "Never purchase e-ticket from unauthorized agents or persons using their personal IDs for commercial purposes. Such tickets are liable to be cancelled and forfeited without any refund of money, under section (143) of the Indian Railway Act 1989. List of authorized agents are available on www.irctc.co.in under 'Find NGet Agents' option."
              )}
              ${instr(
                10,
                'For detail, Rules, Refund rules, Terms &amp; Conditions of E-Ticketing services, Travel Insurance facility etc. Please visit www.irctc.co.in'
              )}
              ${instr(
                11,
                'While booking this ticket, you have agreed of having read the Health Protocol of Destination State of your travel. You are again advised to clearly read the Health Protocol advisory of destination state before start of your travel and follow them properly.'
              )}
              ${instr(
                12,
                'The FIR forms are available with on board ticket checking staff, train guard and train escorting RPF/GRP staff.'
              )}
              ${instr(
                13,
                'Variety of meals available in more than 1500 trains. For delivery of meal of your choice on your seat log on to www.ecatering.irctc.co.in or call 1323 Toll Free. For any suggestions/complaints related to Catering services, contact Toll Free No. 1800-111-321 (07.00 hrs to 22.00 hrs)'
              )}
              ${instr(
                14,
                'National Consumer Helpline (NCH) Toll Free Number: 1800-11-400 or 14404'
              )}
              ${instr(
                15,
                'You can book unreserved ticket from UTS APP or ATVMs (Automatic Ticket Vending Machines) located in Railway Stations.'
              )}
              ${instr(
                16,
                'As per RBI guidelines, the refund of Ticket should be given in the same Bank account, which was used for booking. It is necessary that the Bank Account used for booking online ticket should not be closed at least up to 30 days beyond the date of the journey. If accounts are found closed at the time of processing refund, the refund will be regretted by the Bank.'
              )}
            </table>
          </td></tr>
        </table>
      </td>
    </tr>
    <tr height="10"></tr>
    <tr>
      <td colspan="12" align="center" style="border-bottom:2px solid #000;border-top:2px solid #000;">
        <table width="100%"><tr><td style="padding:0 10px;">
          <strong style="font-size:13px;"><u>Customer Care:</u></strong>
          <ul style="list-style-type:disc;padding:0 25px;margin-bottom:5px;">
            <li style="font-size:12px;padding-top:5px;text-align:justify;">
              For e-ticket booking cancellation and refund assistance, please contact us at https://equery.irctc.co.in or call us at 14646 (24X7) (Language: Hindi, English, Punjabi, Bengali, Assamese, Odia, Marathi, Gujarati, Tamil, Telugu, Kannada and Malayalam.)
            </li>
            <li style="font-size:12px;padding-top:5px;text-align:justify;">
              In case a passenger faces any problem in cancelling an E-Ticket online or TDR filing, Write to:etickets@irctc.co.in
            </li>
            <li style="font-size:12px;padding-top:5px;text-align:justify;">
              <b>Customer Support (Outside India):</b> Call: +91-8044647999 / +91-8035734999
            </li>
            <li style="font-size:12px;padding-top:5px;text-align:justify;">
              For Railway Enquiries as well as for giving suggestions/filing complaints on Rail Madad, please contact us at 139 or SMS RAIL to 139.
            </li>
            <li style="font-size:12px;padding-top:5px;text-align:justify;">
              For e-catering, to book and get food delivered on your train berth, please contact us at 1323 (24*7 Hrs Toll Free) or log on to www.ecatering.irctc.co.in.
            </li>
          </ul>
        </td></tr></table>
      </td>
    </tr>`;
}

function buildPassengerRows(passengers) {
  return (passengers || [])
    .map(
      (p, index) => `
      <tr align="center" style="padding-top: 10px; font-family: Calibri; font-size: 14px; color: black;">
        <td width="3%">${index + 1}.</td>
        <td width="19%" align="left">${esc(p.name)}</td>
        <td width="7%" align="left">&nbsp;&nbsp;${esc(p.age)}</td>
        <td width="9%" align="left">&nbsp;&nbsp;${esc(p.gender)}</td>
        <td align="left" width="25%">&nbsp;&nbsp;${esc(p.bookingStatus)}</td>
        <td align="left" width="25%">&nbsp;&nbsp;${esc(p.currentStatus)}</td>
      </tr>`
    )
    .join('');
}

function buildErsHtml(data) {
  const qrSrc = data.qr_code_base64 || '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Electronic Reservation Slip (ERS)</title>
  <style>
    body { font-family: Calibri, sans-serif; background: #fff; margin: 0; padding: 16px; color: #000; }
    @media print {
      @page { margin: 0; }
      body { print-color-adjust: exact; -webkit-print-color-adjust: exact; padding: 0.4cm; margin: 0; }
    }
  </style>
</head>
<body>
  <table width="100%" id="printTable" align="center" cellpadding="0" cellspacing="0" border="0" style="border: 2px solid #000; max-width: 780px; font-family: Calibri;">
    <tr><td>
      <table width="100%"><tr>
        <td width="20%"></td>
        <td width="60%" align="center">
          <u><b><span style="font-size:17px;">Electronic Reservation Slip (ERS)</span></b></u><br>
          <span style="font-size:13px;">-Normal User</span>
        </td>
        <td width="20%"></td>
      </tr></table>
    </td></tr>
    <tr><td>
      <table width="100%"><tr>
        <td width="33%" align="left" style="padding-left:10px;">
          <img alt="rail" width="60" src="${LOGO_RAILWAY}" />
        </td>
        <td width="33%"></td>
        <td width="33%" align="right" style="padding-right:10px;">
          <img alt="irctc" width="60" src="${LOGO_IRCTC}" />
        </td>
      </tr></table>
    </td></tr>
    <tr><td>
      <table width="100%">
        <tr>
          <td width="30%" align="center"><strong>Booked From</strong></td>
          <td width="40%" align="center"><img alt="arrow" src="${LOGO_ARROW}" /></td>
          <td width="30%" align="center"><strong>To</strong></td>
        </tr>
        <tr>
          <td align="center" style="font-size:16px;">${esc(data.source_station)}</td>
          <td align="center" style="font-size:16px;font-weight:bold;">${esc(data.boarding_station)}</td>
          <td align="center" style="font-size:16px;">${esc(data.dest_station)}</td>
        </tr>
        <tr>
          <td align="center">Start Date* ${esc(data.start_date)}</td>
          <td align="center"><strong>Departure* ${esc(data.dep_time)}</strong></td>
          <td align="center">Arrival* ${esc(data.arr_time)}</td>
        </tr>
      </table>
    </td></tr>
    <tr><td style="border-top:2px solid #000;border-bottom:2px solid #000;">
      <table width="100%">
        <tr>
          <td width="22%" align="center"><strong>PNR</strong></td>
          <td width="56%" align="center"><strong>Train No./Name</strong></td>
          <td width="22%" align="center"><strong>Class</strong></td>
        </tr>
        <tr>
          <td align="center" style="font-size:18px;color:rgb(46,116,181);"><strong>${esc(data.pnr)}</strong></td>
          <td align="center" style="font-size:18px;color:rgb(46,116,181);"><strong>${esc(data.train_info)}</strong></td>
          <td align="center" style="font-size:18px;color:rgb(46,116,181);"><strong>${esc(data.travel_class)}</strong></td>
        </tr>
        <tr>
          <td align="center"><strong>Quota</strong></td>
          <td align="center"><strong>Distance</strong></td>
          <td align="center"><strong>Booking Date</strong></td>
        </tr>
        <tr>
          <td align="center">${esc(data.quota)}</td>
          <td align="center">${esc(data.distance)} KM</td>
          <td align="center">${esc(data.booking_date)}</td>
        </tr>
      </table>
    </td></tr>
    <tr><td style="padding:0 10px;"><strong><u>Passenger Details</u></strong></td></tr>
    <tr><td>
      <table width="100%">
        <thead>
          <tr align="center" style="font-size:14px;font-weight:bold;">
            <td width="3%">#</td>
            <td width="19%" align="left">Name</td>
            <td width="7%" align="left">Age</td>
            <td width="9%" align="left">Gender</td>
            <td width="25%" align="left">&nbsp;&nbsp;Booking Status</td>
            <td width="25%" align="left">&nbsp;&nbsp;Current Status</td>
          </tr>
        </thead>
        <tbody>${buildPassengerRows(data.passengers)}</tbody>
      </table>
    </td></tr>
    <tr><td style="padding:0 0 0 10px;border-top:2px solid #000;">
      <table width="100%">
        <tr>
          <td width="10%"><span style="font-size:8px;">Acronyms: </span></td>
          <td width="30%"><span style="font-size:8px;">RLWL: REMOTE LOCATION WAITLIST</span></td>
          <td width="30%"><span style="font-size:8px;">PQWL: POOLED QUOTA WAITLIST</span></td>
          <td width="30%"><span style="font-size:8px;">RSWL: ROAD-SIDE WAITLIST</span></td>
        </tr>
      </table>
    </td></tr>
    <tr><td style="padding:0 0 0 10px;">
      <table width="100%"><tr>
        <td width="71%" valign="top">
          <div style="font-size:14px;"><strong>Transaction ID: ${esc(data.transaction_id)}</strong></div>
          <div style="font-size:14px;">IR recovers only 57% of cost of travel on an average.</div>
          <div style="font-size:17px;margin-top:6px;"><strong><u>Payment Details</u></strong></div>
          <table width="100%">
            <tr><td style="font-size:13px;">Ticket Fare</td><td style="font-size:13px;">₹ ${esc(data.ticket_fare)}</td></tr>
            <tr><td style="font-size:13px;">IRCTC Convenience Fee (Incl. of GST)</td><td style="font-size:13px;">₹ ${esc(data.conv_fee)}</td></tr>
            <tr><td style="font-size:13px;">Travel Insurance Premium (Incl. of GST)</td><td style="font-size:13px;">₹ ${esc(data.ins_fee)}</td></tr>
            <tr><td style="font-size:13px;"><strong>Total Fare (all inclusive)</strong></td><td style="font-size:13px;"><strong>₹ ${esc(data.total_fare)}</strong></td></tr>
          </table>
          <div style="font-size:11px;">PG Charges as applicable (Additional)</div>
        </td>
        <td width="29%" align="right" valign="top">
          ${
            qrSrc
              ? `<img height="200" width="200" src="${qrSrc}" alt="QR" />`
              : ''
          }
        </td>
      </tr></table>
    </td></tr>
    ${buildErsStaticFooter(data)}
  </table>
</body>
</html>`;
}

async function htmlToPdf(html, pdfPath) {
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      images: true,
    },
  });
  try {
    const tmpHtml = `${pdfPath}.tmp.html`;
    fs.writeFileSync(tmpHtml, html, 'utf8');
    await win.loadFile(tmpHtml);
    await new Promise((r) => setTimeout(r, 800));
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      landscape: false,
      pageSize: 'A4',
      margins: { marginType: 'none' },
    });
    fs.writeFileSync(pdfPath, pdf);
    try {
      fs.unlinkSync(tmpHtml);
    } catch (_) {}
    return pdfPath;
  } finally {
    try {
      if (!win.isDestroyed()) win.destroy();
    } catch (_) {}
  }
}

/**
 * @param {object} fullApiResponse bookingData / verifyPayment JSON with bookingResponseDTO
 * @returns {Promise<{ ok: boolean, path?: string, error?: string }>}
 */
async function printTicket(fullApiResponse) {
  try {
    if (!fullApiResponse || !fullApiResponse.bookingResponseDTO) {
      return { ok: false, error: 'Invalid ticket data' };
    }
    const ticket = firstDto(fullApiResponse);
    if (!ticket) return { ok: false, error: 'bookingResponseDTO empty' };

    const qrText = String(ticket.qrCodeText || '').trim();
    const qrBase64 = await generateQrBase64(qrText);
    const data = mapJourneyData(fullApiResponse, qrBase64);
    const html = buildErsHtml(data);

    const folder = getDesktopPrintFolder();
    const baseName = `${data.fromStn || 'SRC'}_${data.toStn || 'DEST'}_${data.pnr}`;
    const pdfPath = path.join(folder, `${baseName}.pdf`);

    await htmlToPdf(html, pdfPath);
    console.log('[LEXUS Print] PDF saved', pdfPath);
    return { ok: true, path: pdfPath };
  } catch (e) {
    const msg = e?.message || String(e);
    console.warn('[LEXUS Print] failed', msg);
    return { ok: false, error: msg };
  }
}

module.exports = {
  printTicket,
  mapJourneyData,
  getDesktopPrintFolder,
};
