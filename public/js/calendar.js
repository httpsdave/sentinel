/* ═══════════════════════════════════════════════════
   CALENDAR — World events, holidays, and confirmed
   big events displayed in a monthly calendar view
   ═══════════════════════════════════════════════════ */
const Calendar = (() => {
  let container = null;
  let currentDate = new Date();
  let events = [];
  let loading = false;
  let selectedDay = null;

  /* ═══ INIT ═══════════════════════════════════════ */
  function init(el) {
    container = el;
    if (!container) return;
    render();
    loadEvents(currentDate.getFullYear(), currentDate.getMonth());
  }

  /* ═══ LOAD EVENTS FROM SERVER ════════════════════ */
  async function loadEvents(year, month) {
    if (loading) return;
    loading = true;

    try {
      const country = (Store.getSettings().country || 'auto').toUpperCase();
      const countryParam = country !== 'AUTO' ? country : 'US';
      const res = await fetch(`/api/events?year=${year}&month=${month + 1}&country=${countryParam}`);
      const data = await res.json();
      events = data.events || [];
    } catch (err) {
      console.error('[CALENDAR] Failed to load events:', err);
      events = [];
    }

    loading = false;
    render();
  }

  /* ═══ RENDER CALENDAR ════════════════════════════ */
  function render() {
    if (!container) return;

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const today = new Date();

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDow = firstDay.getDay(); // 0=Sun
    const daysInMonth = lastDay.getDate();

    const monthNames = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE',
      'JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];

    // Group events by day
    const eventsByDay = {};
    for (const ev of events) {
      const d = new Date(ev.date);
      if (d.getMonth() === month && d.getFullYear() === year) {
        const day = d.getDate();
        if (!eventsByDay[day]) eventsByDay[day] = [];
        eventsByDay[day].push(ev);
      }
    }

    // Build selected day panel
    let detailHTML = '';
    if (selectedDay && eventsByDay[selectedDay]) {
      const dayEvents = eventsByDay[selectedDay];
      detailHTML = `
        <div class="cal-detail">
          <div class="cal-detail-header">${monthNames[month]} ${selectedDay}, ${year}</div>
          <div class="cal-detail-list">
            ${dayEvents.map(ev => `
              <div class="cal-event-item cal-event-${ev.type || 'holiday'}">
                <span class="cal-event-icon">${getEventIcon(ev.type)}</span>
                <div class="cal-event-info">
                  <div class="cal-event-name">${esc(ev.name)}</div>
                  ${ev.country ? `<span class="cal-event-country">${esc(ev.country)}</span>` : ''}
                  ${ev.description ? `<div class="cal-event-desc">${esc(ev.description)}</div>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </div>`;
    } else if (selectedDay) {
      detailHTML = `
        <div class="cal-detail">
          <div class="cal-detail-header">${monthNames[month]} ${selectedDay}, ${year}</div>
          <div class="cal-detail-empty">No events on this date.</div>
        </div>`;
    }

    // Upcoming events (next 30 days from today)
    const upcoming = events
      .filter(ev => {
        const evDate = new Date(ev.date);
        const diff = (evDate - today) / 86400000;
        return diff >= -1 && diff <= 60;
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 12);

    const upcomingHTML = upcoming.length ? `
      <div class="cal-upcoming">
        <div class="cal-upcoming-header">◈ UPCOMING EVENTS</div>
        ${upcoming.map(ev => {
          const evDate = new Date(ev.date);
          const dayDiff = Math.ceil((evDate - today) / 86400000);
          const when = dayDiff === 0 ? 'TODAY' : dayDiff === 1 ? 'TOMORROW' : dayDiff < 0 ? `${Math.abs(dayDiff)}d AGO` : `IN ${dayDiff}d`;
          return `
            <div class="cal-upcoming-item cal-event-${ev.type || 'holiday'}">
              <span class="cal-event-icon">${getEventIcon(ev.type)}</span>
              <div class="cal-upcoming-info">
                <span class="cal-upcoming-name">${esc(ev.name)}</span>
                ${ev.country ? `<span class="cal-event-country">${esc(ev.country)}</span>` : ''}
              </div>
              <span class="cal-upcoming-when">${when}</span>
              <span class="cal-upcoming-date">${evDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
            </div>`;
        }).join('')}
      </div>` : '';

    // Calendar grid
    let cells = '';
    // Empty cells before first day
    for (let i = 0; i < startDow; i++) {
      cells += '<div class="cal-cell cal-empty"></div>';
    }
    // Day cells
    for (let d = 1; d <= daysInMonth; d++) {
      const isToday = d === today.getDate() && month === today.getMonth() && year === today.getFullYear();
      const hasEvents = eventsByDay[d] && eventsByDay[d].length > 0;
      const isSelected = d === selectedDay;
      const eventDots = hasEvents ? eventsByDay[d].slice(0, 3).map(ev =>
        `<span class="cal-dot cal-dot-${ev.type || 'holiday'}"></span>`
      ).join('') : '';

      cells += `<div class="cal-cell ${isToday ? 'cal-today' : ''} ${hasEvents ? 'cal-has-events' : ''} ${isSelected ? 'cal-selected' : ''}" data-day="${d}">
        <span class="cal-day-num">${d}</span>
        <div class="cal-dots">${eventDots}</div>
      </div>`;
    }

    container.innerHTML = `
      <div class="cal-wrapper">
        <div class="cal-main">
          <div class="cal-header">
            <button class="cal-nav-btn" id="cal-prev">◂</button>
            <div class="cal-title">${monthNames[month]} ${year}</div>
            <button class="cal-nav-btn" id="cal-next">▸</button>
            <button class="cal-nav-btn cal-today-btn" id="cal-go-today">TODAY</button>
          </div>
          <div class="cal-grid">
            <div class="cal-dow">SUN</div><div class="cal-dow">MON</div><div class="cal-dow">TUE</div>
            <div class="cal-dow">WED</div><div class="cal-dow">THU</div><div class="cal-dow">FRI</div><div class="cal-dow">SAT</div>
            ${cells}
          </div>
          ${detailHTML}
        </div>
        ${upcomingHTML}
        <div class="cal-legend">
          <span class="cal-legend-item"><span class="cal-dot cal-dot-holiday"></span> Holiday</span>
          <span class="cal-legend-item"><span class="cal-dot cal-dot-religious"></span> Religious</span>
          <span class="cal-legend-item"><span class="cal-dot cal-dot-observance"></span> Observance</span>
          <span class="cal-legend-item"><span class="cal-dot cal-dot-election"></span> Election</span>
          <span class="cal-legend-item"><span class="cal-dot cal-dot-political"></span> Political</span>
          <span class="cal-legend-item"><span class="cal-dot cal-dot-cultural"></span> Cultural</span>
          <span class="cal-legend-item"><span class="cal-dot cal-dot-sports"></span> Sports</span>
        </div>
        ${loading ? '<div class="cal-loading">SCANNING EVENT DATA...</div>' : ''}
      </div>`;

    // Bind events
    container.querySelector('#cal-prev')?.addEventListener('click', () => navigateMonth(-1));
    container.querySelector('#cal-next')?.addEventListener('click', () => navigateMonth(1));
    container.querySelector('#cal-go-today')?.addEventListener('click', goToday);

    container.querySelectorAll('.cal-cell[data-day]').forEach(cell => {
      cell.addEventListener('click', () => {
        selectedDay = parseInt(cell.dataset.day);
        render();
      });
    });
  }

  function navigateMonth(delta) {
    currentDate.setMonth(currentDate.getMonth() + delta);
    selectedDay = null;
    render();
    loadEvents(currentDate.getFullYear(), currentDate.getMonth());
  }

  function goToday() {
    currentDate = new Date();
    selectedDay = new Date().getDate();
    render();
    loadEvents(currentDate.getFullYear(), currentDate.getMonth());
  }

  function getEventIcon(type) {
    switch (type) {
      case 'holiday': return '🏛️';
      case 'religious': return '🕊️';
      case 'election': return '🗳️';
      case 'political': return '📜';
      case 'cultural': return '🎭';
      case 'sports': return '🏆';
      case 'observance': return '📅';
      default: return '◈';
    }
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  function resize() {
    // Calendar auto-resizes via CSS
  }

  return { init, resize, loadEvents };
})();
