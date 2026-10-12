document.addEventListener('DOMContentLoaded', async () => {
  let selectedDate = '';
  let lastCheckedTrain = null;
  let searchQuery = null;

  const resultsTable = document.getElementById('results-table');
  const globalCheckBtn = document.getElementById('global-check-availability-btn');
  const titleEl = document.getElementById('title');

  if (!window.lexusTrains) {
    titleEl.textContent = 'Bridge missing';
    return;
  }

  const query = await window.lexusTrains.getQuery();
  searchQuery = query;
  if (!query || !query.from || !query.to || !query.date) {
    titleEl.textContent = 'Missing From / To / Date';
    resultsTable.innerHTML = '<tr><td>Fill journey fields pehle, phir Search dabao.</td></tr>';
    return;
  }

  selectedDate = query.date;
  titleEl.textContent = `${query.from} → ${query.to} · ${query.date}`;
  resultsTable.innerHTML = '<tr><td>Fetching trains…</td></tr>';

  async function pushSelectionToBook({ closeResults = false } = {}) {
    if (!lastCheckedTrain) return;
    const selectedQuota = document.querySelector('input[name="global_quota"]:checked').value;
    await window.lexusTrains.applySelection({
      trainNo: `${lastCheckedTrain.trainNumber}- ${lastCheckedTrain.trainName}`,
      trainClass: lastCheckedTrain.classCode,
      actualDestination: lastCheckedTrain.actualDestination,
      actualSource: lastCheckedTrain.actualSource,
      quota: selectedQuota,
      from: searchQuery?.from,
      to: searchQuery?.to,
      date: searchQuery?.date,
      closeResults,
    });
  }

  try {
    const res = await window.lexusTrains.fetchList(query);
    if (!res.ok) throw new Error(res.error || 'Fetch failed');
    parseAndDisplayErailTrains(res.trains || [], selectedDate);
  } catch (e) {
    console.error(e);
    resultsTable.innerHTML = `<tr><td>Failed: ${e.message || e}</td></tr>`;
  }

  resultsTable.addEventListener('click', (e) => {
    const target = e.target;
    if (!target.classList.contains('class-selector')) return;

    document.querySelectorAll('.class-selector.selected').forEach((el) => el.classList.remove('selected'));
    target.classList.add('selected');

    const { trainNumber, trainName, classCode } = target.dataset;
    const tableRow = target.closest('tr');
    const trainData = JSON.parse(tableRow.getAttribute('data-train'));

    lastCheckedTrain = {
      trainNumber,
      trainName,
      classCode,
      fromCode: trainData.s,
      toCode: trainData.d,
      actualSource: trainData.s,
      actualDestination: trainData.d,
      trainType: mapErailTrainType(trainData),
    };

    const selectedQuota = document.querySelector('input[name="global_quota"]:checked').value;
    fetchSeatAvailability(
      trainNumber,
      classCode,
      trainData.s,
      trainData.d,
      selectedDate,
      selectedQuota,
      lastCheckedTrain.trainType
    );
  });

  document.querySelectorAll('input[name="global_quota"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!lastCheckedTrain) return;
      fetchSeatAvailability(
        lastCheckedTrain.trainNumber,
        lastCheckedTrain.classCode,
        lastCheckedTrain.fromCode,
        lastCheckedTrain.toCode,
        selectedDate,
        radio.value,
        lastCheckedTrain.trainType
      );
    });
  });

  globalCheckBtn.addEventListener('click', async () => {
    if (!lastCheckedTrain) {
      alert('Pehle class select karo.');
      return;
    }
    await pushSelectionToBook({ closeResults: true });
  });
});

function mapErailTrainType(trainData) {
  return String(trainData?.type || trainData?.typ || 'EXP').trim() || 'EXP';
}

function parseTotalFare(avlData) {
  if (!avlData) return null;
  for (const key of ['totalFare', 'fare', 'fareAmt', 'fareAmount']) {
    if (typeof avlData[key] === 'number') return avlData[key];
  }
  if (Array.isArray(avlData.avlDayList) && avlData.avlDayList.length > 0) {
    const dayInfo = avlData.avlDayList[0];
    for (const key of ['totalFare', 'fare', 'fareAmt', 'fareAmount']) {
      if (typeof dayInfo[key] === 'number') return dayInfo[key];
    }
  }
  return null;
}

function parseAndDisplayErailTrains(trains, selectedDate) {
  const resultsTable = document.getElementById('results-table');
  try {
    let tableHTML =
      '<thead><tr><th>Number</th><th>Name</th><th>From</th><th>Dep</th><th>To</th><th>Arr</th><th>Classes</th></tr></thead><tbody>';
    let trainsFoundCount = 0;

    (trains || []).forEach((tr) => {
      trainsFoundCount += 1;
      const trainData = {
        num: tr.train_no,
        name: tr.name,
        s: tr.board_code,
        st: tr.depart,
        d: tr.alight_code,
        dt: tr.arrive,
        type: tr.type || '',
        classes: tr.classes || [],
      };
      const classesHTML = (trainData.classes || [])
        .map((cls) => {
          const code = String(cls).trim();
          if (!code) return '';
          return `<span class="class-selector" data-train-number="${trainData.num}" data-train-name="${trainData.name}" data-class-code="${code}">${code}</span>`;
        })
        .join('');

      tableHTML += `<tr data-train='${JSON.stringify(trainData).replace(/'/g, '&#39;')}'>
        <td>${trainData.num}</td><td>${trainData.name}</td><td>${trainData.s}</td><td>${trainData.st}</td><td>${trainData.d}</td><td>${trainData.dt}</td>
        <td>${classesHTML}</td></tr>`;
    });

    tableHTML += '</tbody>';
    resultsTable.innerHTML =
      trainsFoundCount > 0
        ? tableHTML
        : '<tr><td colspan="7">Is date pe koi train nahi mili.</td></tr>';
  } catch (e) {
    console.error(e);
    resultsTable.innerHTML = '<tr><td colspan="7">Error parsing train list.</td></tr>';
  }
}

function availabilityButtonColor(status) {
  const up = String(status || '').toUpperCase();
  if (
    up.includes('NOT AVAILABLE') ||
    up.includes('NOT ALLOWED') ||
    up.includes('BOOKING NOT') ||
    up.includes('ERROR')
  ) {
    return '#b42318';
  }
  if (up.includes('AVAILABLE')) return '#1f7a4d';
  if (up.includes('WL') || up.includes('RAC')) return '#d97706';
  return '#b42318';
}

function showAvailabilityOnButton(button, status, fare = null) {
  status = window.LexusAvailabilityFormat.message(status, 'Availability response could not be read. Try again.');
  button.textContent = status;
  if (fare !== null && Number.isFinite(Number(fare))) {
    button.appendChild(document.createElement('br'));
    button.appendChild(document.createTextNode(`Rs. ${Number(fare)}`));
  }
  button.style.backgroundColor = availabilityButtonColor(status);
  button.style.color = '#fff';
}

let availabilityRequestId = 0;
async function fetchSeatAvailability(trainNo, classCode, from, to, date, quota, trainType) {
  const requestId = ++availabilityRequestId;
  const globalButton = document.getElementById('global-check-availability-btn');
  globalButton.textContent = 'Loading…';
  globalButton.style.backgroundColor = '#d97706';
  globalButton.style.color = '#fff';

  const dateObj = new Date(date);
  const apiDate = `${String(dateObj.getDate()).padStart(2, '0')}-${String(
    dateObj.getMonth() + 1
  ).padStart(2, '0')}-${dateObj.getFullYear()}`;

  try {
    const response = await window.lexusTrains.fetchAvailability({
      trainNo,
      classCode,
      fromCode: from,
      toCode: to,
      date: apiDate,
      quota,
      trainType: trainType || 'EXP',
    });

    if (requestId !== availabilityRequestId) return;
    if (!response.ok) {
      showAvailabilityOnButton(globalButton, response.error || 'Not Available');
      return;
    }

    const availabilityData = response.data || {};
    let status = 'Not Available';
    const fare = parseTotalFare(availabilityData);

    const errorText = window.LexusAvailabilityFormat.message(availabilityData.errorMessage);
    if (errorText) {
      status = errorText;
    } else if (availabilityData.avlDayList && availabilityData.avlDayList.length > 0) {
      const dateKey = window.LexusAvailabilityFormat.dateKey;
      const dayInfo = availabilityData.avlDayList.find((d) => dateKey(d.availablityDate || d.availabilityDate) === dateKey(date));
      status = dayInfo ? (dayInfo.availablityStatus || dayInfo.availabilityStatus) : 'No availability returned for the selected date';
    }

    showAvailabilityOnButton(globalButton, status, fare);
  } catch (e) {
    if (requestId !== availabilityRequestId) return;
    console.error(e);
    const msg = String(e.message || e);
    const friendly = msg.includes('Session out')
      ? 'Session/captcha — dubara class click karo'
      : msg.slice(0, 80);
    showAvailabilityOnButton(globalButton, friendly);
  }
}
