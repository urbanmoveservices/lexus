/**
 * STAR-style booking history mapping from IRCTC bookingResponseDTO / bookingData JSON.
 * Used by Direct API success only (not Classic/Beta).
 */

function stationCode(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const parts = s.split(' - ');
  if (parts.length > 1) return parts[parts.length - 1].trim().toUpperCase();
  return s.toUpperCase();
}

function formatJourneyDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  // 2026-09-09T00:00:00.000 → 09-09-2026 (STAR Jrny Date style)
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) return s;
  return s;
}

function formatBookingDate(raw) {
  const s = String(raw || '').trim();
  if (!s) {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
  }
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
  if (m) return `${m[1]} ${m[2]}`;
  const d = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (d) return d[1];
  return s.slice(0, 19);
}

function firstDto(fullData) {
  if (!fullData || typeof fullData !== 'object') return null;
  const dto = fullData.bookingResponseDTO;
  if (Array.isArray(dto) && dto.length) return dto[0];
  if (dto && typeof dto === 'object') return dto;
  return null;
}

/**
 * Build STAR history row fields from bookingData / verifyPayment JSON + run extras.
 * @param {object|null} fullData
 * @param {{ userId?: string, bankFallback?: string, journey?: object }} [extras]
 */
function mapStarHistoryFields(fullData, extras = {}) {
  const ticket = firstDto(fullData) || {};
  const journey = extras.journey || {};

  const from =
    stationCode(ticket.fromStn) ||
    stationCode(journey.from) ||
    stationCode(journey.fromStation) ||
    '';
  const to =
    stationCode(ticket.destStn || ticket.resvnUptoStn) ||
    stationCode(journey.to) ||
    stationCode(journey.toStation) ||
    '';

  const pnr = String(ticket.pnrNumber || extras.pnr || '').trim();
  const fareRaw =
    fullData?.totalCollectibleAmount ??
    ticket.totalCollectibleAmount ??
    ticket.totalFare ??
    '';
  const fare = fareRaw === '' || fareRaw == null ? '' : String(fareRaw);

  const bank =
    String(ticket.bankNameDis || '').trim() ||
    String(extras.bankFallback || '').trim() ||
    '';

  const journeyDate =
    formatJourneyDate(ticket.journeyDate || ticket.boardingDate) ||
    formatJourneyDate(journey.date) ||
    '';

  const bookingDate = formatBookingDate(
    ticket.bookingDate || fullData?.bookingDate || ''
  );

  const userId = String(extras.userId || '').trim();
  const ticketName =
    from && to ? `${from}_${to}` : String(journey.name || '').trim() || 'TICKET';

  return {
    ticketName,
    userId,
    fromStn: from,
    toStn: to,
    journeyDate,
    bankName: bank,
    pnr,
    fare,
    bookingDate,
    trainNo: String(ticket.trainNumber || journey.trainNo || '').trim(),
    trainName: String(ticket.trainName || '').trim(),
    class: String(ticket.journeyClass || journey.class || '').trim(),
    quota: String(ticket.journeyQuota || ticket.bookedQuota || journey.quota || '').trim(),
  };
}

module.exports = {
  firstDto,
  mapStarHistoryFields,
  formatJourneyDate,
  formatBookingDate,
  stationCode,
};
