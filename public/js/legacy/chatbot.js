/* ============================================
   PackZen Support Chat — Apple Support Style
   Usage: <script src="chatbot.js"></script>
   ============================================ */

(function () {
  const WA_NUMBER = '919945095453';

  const FAQS = [
    { q: 'What are your charges?', a: 'Our pricing starts at ₹3,000 for a 1BHK local move in Bengaluru. The final quote depends on your home size, distance, and floor details. Would you like a custom quote?' },
    { q: 'Which areas do you serve?', a: 'We cover all areas across Bengaluru — Koramangala, Indiranagar, Whitefield, HSR Layout, Marathahalli, Jayanagar, JP Nagar, Bannerghatta, Yelahanka and more.' },
    { q: 'What services do you offer?', a: 'We offer Home Shifting, Office Relocation, Packing Only, Loading & Unloading, and Furniture Assembly & Disassembly.' },
    { q: 'How do you handle fragile items?', a: 'We use bubble wrap, foam padding, and double-wall boxes for all fragile items like glassware, electronics, and artwork. Your belongings are in safe hands.' },
    { q: 'What payment methods do you accept?', a: 'We accept Cash, UPI (GPay, PhonePe, Paytm), and bank transfer. Payment is collected after the move is successfully completed.' },
    { q: 'Can I cancel or reschedule?', a: 'Yes, you can cancel or reschedule up to 24 hours before the move at no charge. Just contact us and we\'ll sort it out.' },
    { q: 'How long does a move take?', a: 'A typical 1BHK move takes 4–6 hours and a 2BHK takes 6–9 hours, including packing, loading, transit, and unloading.' },
    { q: 'Are you available on weekends?', a: 'Yes! We\'re available 7 days a week from 7 AM to 8 PM, including weekends and public holidays.' },
  ];

  const STEPS = [
    { key: 'name',  label: 'Your Name',        placeholder: 'e.g. Rahul Sharma',            type: 'text' },
    { key: 'phone', label: 'Mobile Number',     placeholder: 'e.g. 9876543210',              type: 'tel'  },
    { key: 'from',  label: 'Pickup Location',   placeholder: 'e.g. Koramangala, Bengaluru',  type: 'text' },
    { key: 'to',    label: 'Drop Location',     placeholder: 'e.g. Whitefield, Bengaluru',   type: 'text' },
    { key: 'date',  label: 'Preferred Date',    placeholder: 'e.g. 20 May or ASAP',          type: 'text' },
    { key: 'size',  label: 'Home / Items Size', placeholder: 'e.g. 2BHK, Office, Few items', type: 'text' },
  ];

  /* ── STYLES ── */
  const CSS = `
    #pzs-fab {
      position:fixed;bottom:28px;right:28px;z-index:9998;
      width:56px;height:56px;border-radius:50%;
      background:#000;border:none;cursor:pointer;
      box-shadow:0 4px 20px rgba(0,0,0,.28),0 1px 4px rgba(0,0,0,.15);
      display:flex;align-items:center;justify-content:center;
      transition:transform .2s,box-shadow .2s;
      animation:pzsFabIn .5s cubic-bezier(.34,1.56,.64,1) both;
    }
    #pzs-fab:hover{transform:scale(1.07);box-shadow:0 8px 28px rgba(0,0,0,.32);}
    #pzs-fab:active{transform:scale(0.94);}
    #pzs-fab svg{width:24px;height:24px;}
    .pzs-badge{
      position:absolute;top:-2px;right:-2px;width:18px;height:18px;
      background:#0071e3;border-radius:50%;border:2px solid #fff;
      display:flex;align-items:center;justify-content:center;
      font-size:10px;font-weight:700;color:#fff;font-family:-apple-system,sans-serif;
    }
    #pzs-window{
      position:fixed;bottom:96px;right:28px;z-index:9999;
      width:380px;max-width:calc(100vw - 24px);
      height:580px;max-height:calc(100vh - 120px);
      background:#fff;border-radius:20px;
      box-shadow:0 0 0 1px rgba(0,0,0,.07),0 24px 64px rgba(0,0,0,.16),0 8px 20px rgba(0,0,0,.08);
      display:flex;flex-direction:column;overflow:hidden;
      font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Arial,sans-serif;
      transform:translateY(14px) scale(0.97);opacity:0;
      transition:transform .28s cubic-bezier(.34,1.2,.64,1),opacity .22s ease;
      pointer-events:none;
    }
    #pzs-window.open{transform:translateY(0) scale(1);opacity:1;pointer-events:all;}

    /* HEADER */
    .pzs-hdr{background:#1c1c1e;padding:14px 16px;display:flex;align-items:center;gap:12px;flex-shrink:0;}
    .pzs-hdr-icon{width:36px;height:36px;border-radius:9px;background:#2c2c2e;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
    .pzs-hdr-icon svg{width:20px;height:20px;}
    .pzs-hdr-title{color:#fff;font-size:.9rem;font-weight:600;letter-spacing:-.01em;}
    .pzs-hdr-sub{color:rgba(255,255,255,.45);font-size:.7rem;margin-top:1px;}
    .pzs-hdr-close{margin-left:auto;background:#3a3a3c;border:none;color:rgba(255,255,255,.6);width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .15s;}
    .pzs-hdr-close:hover{background:#48484a;color:#fff;}

    /* BODY */
    .pzs-body{flex:1;overflow-y:auto;padding:18px 14px 8px;display:flex;flex-direction:column;gap:2px;background:#fff;}
    .pzs-body::-webkit-scrollbar{width:0;}

    /* MESSAGE GROUPS */
    .pzs-grp{display:flex;flex-direction:column;margin-bottom:14px;animation:pzsMsgIn .22s ease;}
    .pzs-grp.bot{align-items:flex-start;}
    .pzs-grp.user{align-items:flex-end;}
    .pzs-sender{font-size:.67rem;font-weight:600;color:#8e8e93;margin-bottom:5px;display:flex;align-items:center;gap:5px;}
    .pzs-live{width:6px;height:6px;border-radius:50%;background:#34c759;display:inline-block;}
    .pzs-bbl{max-width:86%;padding:10px 13px;border-radius:17px;font-size:.875rem;line-height:1.55;color:#1c1c1e;margin-bottom:2px;}
    .pzs-grp.bot .pzs-bbl{background:#f2f2f7;border-bottom-left-radius:5px;}
    .pzs-grp.bot .pzs-bbl+.pzs-bbl{border-top-left-radius:5px;border-bottom-left-radius:5px;}
    .pzs-grp.bot .pzs-bbl:last-child{border-bottom-left-radius:17px;}
    .pzs-grp.user .pzs-bbl{background:#000;color:#fff;border-bottom-right-radius:5px;}

    /* TYPING */
    .pzs-typing{background:#f2f2f7;border-radius:17px;border-bottom-left-radius:5px;padding:11px 14px;display:none;gap:4px;align-items:center;width:fit-content;margin-bottom:14px;}
    .pzs-typing.show{display:flex;animation:pzsMsgIn .2s ease;}
    .pzs-typing span{width:6px;height:6px;border-radius:50%;background:#aaa;animation:pzsTyp 1.4s infinite ease;}
    .pzs-typing span:nth-child(2){animation-delay:.2s;}
    .pzs-typing span:nth-child(3){animation-delay:.4s;}

    /* CARDS */
    .pzs-cards{display:flex;flex-direction:column;gap:8px;margin-bottom:14px;animation:pzsMsgIn .25s ease;}
    .pzs-card{background:#fff;border:1px solid #e5e5ea;border-radius:14px;padding:13px 14px;cursor:pointer;display:flex;align-items:center;gap:12px;transition:all .15s;text-align:left;width:100%;font-family:inherit;}
    .pzs-card:hover{border-color:#000;box-shadow:0 2px 10px rgba(0,0,0,.07);}
    .pzs-card:active{background:#f9f9f9;}
    .pzs-cicon{width:38px;height:38px;border-radius:10px;background:#f2f2f7;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;}
    .pzs-ctxt{flex:1;}
    .pzs-ctitle{font-size:.875rem;font-weight:600;color:#1c1c1e;}
    .pzs-csub{font-size:.73rem;color:#8e8e93;margin-top:2px;}
    .pzs-chev{color:#c7c7cc;font-size:18px;font-weight:300;flex-shrink:0;}

    /* CHIPS */
    .pzs-chips{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:14px;animation:pzsMsgIn .22s ease;}
    .pzs-chip{background:#f2f2f7;border:1px solid #e5e5ea;border-radius:20px;padding:7px 15px;font-size:.8rem;font-weight:500;color:#1c1c1e;cursor:pointer;font-family:inherit;transition:all .15s;white-space:nowrap;}
    .pzs-chip:hover{background:#000;color:#fff;border-color:#000;}
    .pzs-chip.accent{background:rgba(0,113,227,.07);border-color:rgba(0,113,227,.2);color:#0071e3;}
    .pzs-chip.accent:hover{background:#0071e3;color:#fff;border-color:#0071e3;}

    /* FORM */
    .pzs-form{background:#f9f9fb;border:1px solid #e5e5ea;border-radius:16px;padding:16px;margin-bottom:14px;animation:pzsMsgIn .22s ease;}
    .pzs-prog{display:flex;gap:4px;margin-bottom:12px;}
    .pzs-pd{height:3px;border-radius:2px;background:#e5e5ea;flex:1;transition:background .3s;}
    .pzs-pd.done{background:#1c1c1e;}
    .pzs-pd.active{background:#0071e3;}
    .pzs-flbl{font-size:.7rem;font-weight:600;color:#8e8e93;text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;}
    .pzs-fchips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;}
    .pzs-finp{width:100%;padding:11px 13px;border:1px solid #e5e5ea;border-radius:10px;font-family:inherit;font-size:.875rem;color:#1c1c1e;background:#fff;outline:none;transition:border-color .15s;-webkit-appearance:none;}
    .pzs-finp:focus{border-color:#0071e3;box-shadow:0 0 0 3px rgba(0,113,227,.08);}
    .pzs-ferr{font-size:.73rem;color:#ff3b30;margin-top:5px;display:none;}
    .pzs-fnext{width:100%;margin-top:10px;padding:11px;background:#000;color:#fff;border:none;border-radius:10px;font-family:inherit;font-size:.875rem;font-weight:600;cursor:pointer;transition:background .15s;letter-spacing:-.01em;}
    .pzs-fnext:hover{background:#1c1c1e;}
    .pzs-fskip{width:100%;margin-top:5px;padding:7px;background:transparent;border:none;font-family:inherit;font-size:.76rem;color:#8e8e93;cursor:pointer;}
    .pzs-fskip:hover{color:#1c1c1e;}

    /* SUMMARY */
    .pzs-sum{border:1px solid #e5e5ea;border-radius:16px;overflow:hidden;margin-bottom:14px;animation:pzsMsgIn .25s ease;}
    .pzs-sum-hdr{background:#1c1c1e;padding:11px 14px;font-size:.72rem;font-weight:600;color:rgba(255,255,255,.55);text-transform:uppercase;letter-spacing:.05em;}
    .pzs-sum-row{display:flex;padding:10px 14px;border-bottom:1px solid #f2f2f7;gap:12px;}
    .pzs-sum-row:last-of-type{border-bottom:none;}
    .pzs-sum-k{font-size:.76rem;color:#8e8e93;width:80px;flex-shrink:0;padding-top:1px;}
    .pzs-sum-v{font-size:.875rem;font-weight:500;color:#1c1c1e;}
    .pzs-wa{display:flex;align-items:center;justify-content:center;gap:8px;background:#000;color:#fff;text-decoration:none;border-radius:11px;padding:12px 14px;font-family:inherit;font-size:.875rem;font-weight:600;margin:12px 14px 14px;transition:background .15s;letter-spacing:-.01em;}
    .pzs-wa:hover{background:#1c1c1e;}
    .pzs-wa svg{width:17px;height:17px;}

    /* FAQ */
    .pzs-faq-list{display:flex;flex-direction:column;gap:6px;margin-bottom:14px;animation:pzsMsgIn .22s ease;}
    .pzs-faq-btn{background:#fff;border:1px solid #e5e5ea;border-radius:12px;padding:11px 14px;cursor:pointer;font-size:.84rem;font-weight:500;color:#1c1c1e;font-family:inherit;text-align:left;width:100%;display:flex;justify-content:space-between;align-items:center;transition:all .15s;gap:8px;}
    .pzs-faq-btn:hover{border-color:#000;background:#fafafa;}
    .pzs-faq-chev{color:#c7c7cc;flex-shrink:0;}

    /* FOOTER */
    .pzs-footer{padding:10px 12px 12px;border-top:1px solid #f2f2f7;flex-shrink:0;display:flex;gap:8px;align-items:flex-end;background:#fff;}
    .pzs-inp{flex:1;padding:10px 13px;border:1px solid #e5e5ea;border-radius:22px;font-family:inherit;font-size:.875rem;color:#1c1c1e;background:#f9f9fb;outline:none;resize:none;max-height:70px;min-height:38px;line-height:1.4;transition:border-color .15s,background .15s;}
    .pzs-inp:focus{border-color:#000;background:#fff;}
    .pzs-send{width:36px;height:36px;border-radius:50%;background:#000;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .15s,transform .1s;}
    .pzs-send:hover{background:#1c1c1e;}
    .pzs-send:active{transform:scale(0.9);}
    .pzs-send svg{width:15px;height:15px;}
    .pzs-pwrd{text-align:center;padding:0 0 4px;font-size:.63rem;color:#c7c7cc;letter-spacing:.02em;}

    @keyframes pzsFabIn{from{transform:scale(0) rotate(-10deg);opacity:0;}to{transform:scale(1) rotate(0);opacity:1;}}
    @keyframes pzsMsgIn{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:translateY(0);}}
    @keyframes pzsTyp{0%,60%,100%{transform:translateY(0);opacity:.4;}30%{transform:translateY(-4px);opacity:1;}}

    @media(max-width:480px){
      #pzs-window{bottom:0;right:0;left:0;width:100%;max-width:100%;border-radius:22px 22px 0 0;height:91vh;max-height:91vh;}
      #pzs-fab{bottom:18px;right:18px;}
    }
  `;

  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);

  /* ── HTML ── */
  const host = document.createElement('div');
  host.innerHTML = `
    <button id="pzs-fab" aria-label="PackZen Support">
      <div class="pzs-badge">1</div>
      <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#fff" stroke-width="1.5"/><path d="M12 16v-4M12 8h.01" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>
    </button>
    <div id="pzs-window" role="dialog">
      <div class="pzs-hdr">
        <div class="pzs-hdr-icon">
          <svg viewBox="0 0 24 24" fill="none"><rect x="2" y="7" width="20" height="14" rx="2" stroke="#fff" stroke-width="1.5"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" stroke="#fff" stroke-width="1.5"/></svg>
        </div>
        <div>
          <div class="pzs-hdr-title">PackZen Support</div>
          <div class="pzs-hdr-sub">Packers & Movers · Bengaluru</div>
        </div>
        <button class="pzs-hdr-close" id="pzs-close">✕</button>
      </div>
      <div class="pzs-body" id="pzs-body">
        <div class="pzs-typing" id="pzs-typing"><span></span><span></span><span></span></div>
      </div>
      <div class="pzs-footer">
        <textarea class="pzs-inp" id="pzs-inp" placeholder="Message…" rows="1"></textarea>
        <button class="pzs-send" id="pzs-send">
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
      <div class="pzs-pwrd">PackZen · Bengaluru's Trusted Movers</div>
    </div>`;
  document.body.appendChild(host);

  /* ── REFS ── */
  const body    = document.getElementById('pzs-body');
  const typing  = document.getElementById('pzs-typing');
  const inp     = document.getElementById('pzs-inp');
  const fab     = document.getElementById('pzs-fab');
  const win     = document.getElementById('pzs-window');
  let isOpen = false, greeted = false, mode = 'home', step = 0;
  const booking = {};

  /* ── HELPERS ── */
  const scrollB = () => { body.scrollTop = body.scrollHeight; };

  function addBotGrp(msgs) {
    const g = document.createElement('div');
    g.className = 'pzs-grp bot';
    const snd = document.createElement('div');
    snd.className = 'pzs-sender';
    snd.innerHTML = '<span class="pzs-live"></span> PackZen Support';
    g.appendChild(snd);
    (Array.isArray(msgs) ? msgs : [msgs]).forEach(t => {
      const b = document.createElement('div');
      b.className = 'pzs-bbl'; b.textContent = t;
      g.appendChild(b);
    });
    body.insertBefore(g, typing); scrollB();
  }

  function addUserGrp(text) {
    const g = document.createElement('div');
    g.className = 'pzs-grp user';
    const b = document.createElement('div');
    b.className = 'pzs-bbl'; b.textContent = text;
    g.appendChild(b);
    body.insertBefore(g, typing); scrollB();
  }

  function addEl(el) { body.insertBefore(el, typing); scrollB(); }

  function botSay(msgs, delay = 700) {
    return new Promise(res => {
      typing.classList.add('show'); scrollB();
      setTimeout(() => { typing.classList.remove('show'); addBotGrp(msgs); res(); }, delay);
    });
  }

  /* ── HOME ── */
  async function showHome() {
    mode = 'home';
    await botSay("Hello! Welcome to PackZen Packers & Movers. 👋\n\nHow can we help you today?", 900);
    const c = document.createElement('div');
    c.className = 'pzs-cards';
    [
      { action:'booking', icon:'📦', title:'Book a Move',      sub:'Schedule your packing & moving' },
      { action:'quote',   icon:'💰', title:'Get a Quote',      sub:'Estimate your moving cost'       },
      { action:'faq',     icon:'❓', title:'Ask a Question',   sub:'Services, payment, areas & more' },
      { action:'call',    icon:'📞', title:'Call Us',          sub:'Speak to our team directly'      },
    ].forEach(({ action, icon, title, sub }) => {
      const btn = document.createElement('button');
      btn.className = 'pzs-card';
      btn.innerHTML = `<div class="pzs-cicon">${icon}</div><div class="pzs-ctxt"><div class="pzs-ctitle">${title}</div><div class="pzs-csub">${sub}</div></div><div class="pzs-chev">›</div>`;
      btn.addEventListener('click', () => onCardClick(action, title));
      c.appendChild(btn);
    });
    addEl(c);
  }

  async function onCardClick(action, label) {
    addUserGrp(label);
    if (action === 'booking' || action === 'quote') {
      mode = 'booking'; step = 0;
      await botSay(action === 'quote' ? "Sure! I'll collect a few details to prepare your quote." : "Let's schedule your move. I need a few quick details.", 600);
      showFormStep();
    } else if (action === 'faq') {
      mode = 'faq';
      await botSay("Here are some common questions. Tap one or type your question below.", 600);
      showFaqList();
    } else if (action === 'call') {
      await botSay(["You can call us at:", "📞  9945095453\n\nAvailable 7 days a week, 7 AM – 8 PM."], 600);
      showBackChips();
    }
  }

  /* ── FORM ── */
  function showFormStep() {
    const s = STEPS[step];
    const form = document.createElement('div');
    form.className = 'pzs-form';

    // Progress bar
    const prog = document.createElement('div');
    prog.className = 'pzs-prog';
    STEPS.forEach((_, i) => {
      const d = document.createElement('div');
      d.className = 'pzs-pd' + (i < step ? ' done' : i === step ? ' active' : '');
      prog.appendChild(d);
    });
    form.appendChild(prog);

    const lbl = document.createElement('div');
    lbl.className = 'pzs-flbl';
    lbl.textContent = `Step ${step + 1} of ${STEPS.length}  ·  ${s.label}`;
    form.appendChild(lbl);

    // BHK chips
    if (s.key === 'size') {
      const chips = document.createElement('div');
      chips.className = 'pzs-fchips';
      ['1BHK','2BHK','3BHK','Office','Few items'].forEach(v => {
        const c = document.createElement('button');
        c.className = 'pzs-chip accent'; c.textContent = v; c.type = 'button';
        c.addEventListener('click', () => { finp.value = v; });
        chips.appendChild(c);
      });
      form.appendChild(chips);
    }

    const finp = document.createElement('input');
    finp.type = s.type; finp.className = 'pzs-finp';
    finp.placeholder = s.placeholder;
    form.appendChild(finp);

    const err = document.createElement('div');
    err.className = 'pzs-ferr';
    form.appendChild(err);

    const next = document.createElement('button');
    next.className = 'pzs-fnext';
    next.textContent = step < STEPS.length - 1 ? 'Continue →' : 'Review My Details →';
    form.appendChild(next);

    if (step > 0) {
      const skip = document.createElement('button');
      skip.className = 'pzs-fskip'; skip.textContent = 'Skip';
      skip.addEventListener('click', () => advance(form, 'Not specified', 'Skip'));
      form.appendChild(skip);
    }

    addEl(form);
    setTimeout(() => finp.focus(), 80);

    function submit() {
      const val = finp.value.trim();
      if (!val) { err.textContent = 'Please fill in this field.'; err.style.display = 'block'; return; }
      if (s.key === 'phone' && !/^[6-9]\d{9}$/.test(val.replace(/\s/g,''))) {
        err.textContent = 'Enter a valid 10-digit mobile number.'; err.style.display = 'block'; return;
      }
      advance(form, val, val);
    }

    next.addEventListener('click', submit);
    finp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  }

  function advance(form, value, label) {
    form.style.opacity = '.35'; form.style.pointerEvents = 'none';
    addUserGrp(label);
    booking[STEPS[step].key] = value;
    step++;
    if (step < STEPS.length) showFormStep();
    else showSummary();
  }

  async function showSummary() {
    await botSay("Here's your booking request. Please review the details.", 700);
    const icons = { name:'👤', phone:'📱', from:'📍', to:'🏁', date:'📅', size:'🏠' };
    const labels = { name:'Name', phone:'Phone', from:'Pickup', to:'Drop', date:'Date', size:'Size' };
    const sum = document.createElement('div');
    sum.className = 'pzs-sum';
    sum.innerHTML = `<div class="pzs-sum-hdr">Booking Request</div>` +
      STEPS.map(s => `<div class="pzs-sum-row"><div class="pzs-sum-k">${icons[s.key]} ${labels[s.key]}</div><div class="pzs-sum-v">${booking[s.key] || '—'}</div></div>`).join('');
    const waText = encodeURIComponent(
      `🚚 *New Booking — PackZen*\n\n👤 ${booking.name||'—'}\n📱 ${booking.phone||'—'}\n📍 From: ${booking.from||'—'}\n🏁 To: ${booking.to||'—'}\n📅 Date: ${booking.date||'—'}\n🏠 Size: ${booking.size||'—'}\n\n_Via packzenblr.in_`
    );
    const wa = document.createElement('a');
    wa.href = `https://wa.me/${WA_NUMBER}?text=${waText}`;
    wa.target = '_blank'; wa.className = 'pzs-wa';
    wa.innerHTML = `<svg viewBox="0 0 24 24" fill="#fff"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg> Confirm on WhatsApp`;
    sum.appendChild(wa);
    addEl(sum);
    await botSay("Tap 'Confirm on WhatsApp' — our team will call you back within minutes! 🎉", 900);
    step = 0; mode = 'home';
    setTimeout(() => {
      const chips = makeChips(['Book Another Move','Main Menu']);
      chips.addEventListener('click', e => {
        const c = e.target.closest('.pzs-chip');
        if (!c) return; chips.remove(); addUserGrp(c.textContent);
        if (c.textContent === 'Book Another Move') { mode='booking'; step=0; Object.keys(booking).forEach(k=>delete booking[k]); botSay("Let's get started!",500).then(showFormStep); }
        else showHome();
      });
      addEl(chips);
    }, 1200);
  }

  /* ── FAQ ── */
  function showFaqList() {
    const list = document.createElement('div');
    list.className = 'pzs-faq-list';
    FAQS.forEach(faq => {
      const btn = document.createElement('button');
      btn.className = 'pzs-faq-btn';
      btn.innerHTML = `<span>${faq.q}</span><span class="pzs-faq-chev">›</span>`;
      btn.addEventListener('click', async () => {
        list.style.opacity='.3'; list.style.pointerEvents='none';
        addUserGrp(faq.q);
        await botSay(faq.a, 700);
        showBackChips();
      });
      list.appendChild(btn);
    });
    addEl(list);
  }

  function makeChips(labels) {
    const chips = document.createElement('div');
    chips.className = 'pzs-chips';
    labels.forEach(l => {
      const c = document.createElement('button');
      c.className = 'pzs-chip'; c.textContent = l;
      chips.appendChild(c);
    });
    return chips;
  }

  function showBackChips() {
    const chips = makeChips(['📦 Book a Move','❓ More Questions','🏠 Main Menu']);
    chips.addEventListener('click', e => {
      const c = e.target.closest('.pzs-chip'); if(!c) return;
      chips.remove(); addUserGrp(c.textContent);
      const t = c.textContent;
      if (t.includes('Book')) { mode='booking'; step=0; botSay("Let's schedule your move!",500).then(showFormStep); }
      else if (t.includes('Questions')) { botSay("Sure, here are more topics.",500).then(showFaqList); }
      else showHome();
    });
    addEl(chips);
  }

  /* ── FREE TEXT ── */
  async function handleText(text) {
    if (!text.trim()) return;
    addUserGrp(text);
    inp.value=''; inp.style.height='auto';
    const t = text.toLowerCase();
    if (t.match(/\b(book|move|shift|moving|relocat|packers|movers)\b/)) {
      mode='booking'; step=0;
      await botSay("Let's get your move scheduled!",600); return showFormStep();
    }
    if (t.match(/\b(quote|price|cost|rate|charge|how much)\b/)) {
      mode='booking'; step=0;
      await botSay("I'll collect your details for an accurate quote.",600); return showFormStep();
    }
    if (t.match(/\b(call|phone|number|contact)\b/)) {
      await botSay(["📞  9945095453","Available 7 AM – 8 PM, 7 days a week."],600); return showBackChips();
    }
    const faq = FAQS.find(f => f.q.toLowerCase().split(/\W+/).some(w => w.length>3 && t.includes(w)));
    if (faq) { await botSay(faq.a,700); return showBackChips(); }
    await botSay("I'm not sure about that, but our team can help right away!\n\n📞  9945095453",700);
    showBackChips();
  }

  /* ── TOGGLE ── */
  function toggle() {
    isOpen = !isOpen;
    win.classList.toggle('open', isOpen);
    fab.querySelector('.pzs-badge').style.display = isOpen ? 'none' : '';
    if (isOpen && !greeted) { greeted=true; setTimeout(showHome,350); }
    if (isOpen) setTimeout(() => inp.focus(), 320);
  }

  fab.addEventListener('click', toggle);
  document.getElementById('pzs-close').addEventListener('click', toggle);
  document.getElementById('pzs-send').addEventListener('click', () => handleText(inp.value.trim()));
  inp.addEventListener('keydown', e => { if (e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleText(inp.value.trim());} });
  inp.addEventListener('input', () => { inp.style.height='auto'; inp.style.height=Math.min(inp.scrollHeight,70)+'px'; });

  setTimeout(() => { if(!isOpen){fab.style.transform='scale(1.1)';setTimeout(()=>{fab.style.transform='';},500);} }, 10000);
})();
