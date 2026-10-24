/* PackZen crew assistant (driver.html): instant answers for partners — no server, works
   offline. A floating "Help" button opens a searchable list; urgent issues go to the
   ops line. English, with Hindi/Kannada keywords so riders can type naturally. */
(function () {
  "use strict";
  var OPS = "9945095453";
  var QA = [
    { k: "online offline go online start work duty available ऑनलाइन ಆನ್‌ಲೈನ್", q: "How do I start getting jobs?", a: "Tap the Online switch at the top. You'll only get job offers while you're online and your profile is active. Go offline when you finish for the day." },
    { k: "offer accept decline reject new job ऑफर ಆಫರ್ 5 minutes timer", q: "How do job offers work?", a: "A new offer shows the area, date, service and your earning. You have 5 minutes to accept — after that it moves to the next partner. Declining doesn't hurt you, but accepting and not going does." },
    { k: "otp code complete finish done delivered close job कोड ಕೋಡ್", q: "How do I complete a job?", a: "At the end of the job, ask the customer for their 4–6 digit completion code. Enter it in the job and tap Complete. If the customer can't find it, call ops — never mark a job done without the code." },
    { k: "cash upi balance collect payment money paisa पैसे ಹಣ due", q: "How do I collect the balance payment?", a: "If the job shows a balance due, collect it by UPI (preferred) or cash, then tap Record collection and choose Cash or UPI. The job can't be completed while money is still due. Cash you collect is deducted from your next payout." },
    { k: "earnings payout salary paid weekly money kamai कमाई ಗಳಿಕೆ", q: "How much do I earn and when am I paid?", a: "You keep 90% of each job's value (PackZen's fee is 10%). The Earnings tab shows your share, cash you hold, what's been paid to you and what's pending. Payouts are recorded by PackZen admin to your registered bank/UPI." },
    { k: "damage broken scratch accident नुकसान ಹಾನಿ", q: "Something got damaged — what now?", a: "Stay calm, take clear photos immediately, tell the customer honestly and call ops on " + OPS + " before leaving the site. Don't promise compensation yourself — PackZen handles claims." },
    { k: "late traffic delay running late customer not answering wait", q: "I'm running late / customer not answering", a: "Call the customer from the job screen. If they don't answer in 10 minutes, call ops on " + OPS + ". Never cancel a job yourself." },
    { k: "reschedule cancel customer wants change date", q: "Customer wants to change the date or cancel", a: "Ask them to use My Bookings on the website or call PackZen — only the office can reschedule or cancel. Tell ops so your schedule is updated." },
    { k: "documents kyc rc insurance update phone bank change profile", q: "How do I update my documents or bank details?", a: "Open the partner portal → Profile, or send updated documents to ops on WhatsApp. Changes to bank details are verified before your next payout." },
    { k: "fragile packing wrap fridge tv glass furniture", q: "Packing fragile items", a: "Wrap TVs, glass and mirrors in bubble wrap + blanket, keep them upright, and load them last/unload first. Fridges: empty, defrosted, doors taped, transported upright. Mark every box with room + FRAGILE." },
    { k: "society lift gate pass building rules security", q: "Society / lift / gate-pass rules", a: "Check the job notes for lift booking and timings. Be polite to security, carry your ID, use the service lift and protect lift walls with blankets." },
    { k: "help support emergency ops call office contact", q: "How do I contact PackZen ops?", a: "Call or WhatsApp ops on " + OPS + " (8 AM – 9 PM). For emergencies on a job, call immediately." },
  ];
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function score(item, q) { var t = q.toLowerCase().split(/\s+/).filter(Boolean); var hay = (item.k + " " + item.q + " " + item.a).toLowerCase(); return t.reduce(function (n, w) { return n + (hay.indexOf(w) >= 0 ? 1 : 0); }, 0); }
  function build() {
    var btn = document.createElement("button");
    btn.type = "button"; btn.id = "crewHelpBtn"; btn.setAttribute("aria-label", "Crew help"); btn.innerHTML = "?";
    var panel = document.createElement("div");
    panel.id = "crewHelp"; panel.hidden = true; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Crew help");
    panel.innerHTML = '<div class="ch-head"><b>Crew help</b><button type="button" class="ch-x" aria-label="Close">×</button></div>' +
      '<input class="ch-q" placeholder="Ask: OTP, cash, payout, packing…" aria-label="Search help">' +
      '<div class="ch-list"></div><a class="ch-call" href="tel:' + OPS + '">📞 Call ops · ' + OPS + '</a>';
    document.body.appendChild(btn); document.body.appendChild(panel);
    var list = panel.querySelector(".ch-list"), input = panel.querySelector(".ch-q");
    function render() {
      var q = input.value.trim();
      var items = q ? QA.map(function (x) { return [score(x, q), x]; }).filter(function (p) { return p[0] > 0; }).sort(function (a, b) { return b[0] - a[0]; }).map(function (p) { return p[1]; }) : QA;
      list.innerHTML = items.length ? items.map(function (x) { return '<details><summary>' + esc(x.q) + '</summary><p>' + esc(x.a) + '</p></details>'; }).join("") : '<p class="ch-none">No answer for that — call ops on ' + OPS + '.</p>';
      if (q && items.length) list.querySelector("details").open = true;
    }
    input.addEventListener("input", render); render();
    btn.addEventListener("click", function () { panel.hidden = !panel.hidden; if (!panel.hidden) input.focus(); });
    panel.querySelector(".ch-x").addEventListener("click", function () { panel.hidden = true; });
  }
  var css = document.createElement("style");
  css.textContent = '#crewHelpBtn{position:fixed;right:16px;bottom:calc(84px + env(safe-area-inset-bottom,0px));z-index:900;width:48px;height:48px;border-radius:50%;border:0;background:#1F9D5C;color:#fff;font:800 1.3rem system-ui;box-shadow:0 10px 24px -10px rgba(21,122,71,.7);cursor:pointer}' +
    '#crewHelp{position:fixed;right:12px;left:12px;bottom:calc(140px + env(safe-area-inset-bottom,0px));max-width:420px;margin-left:auto;max-height:65vh;overflow:auto;z-index:901;background:#fff;color:#0C1A14;border:1px solid rgba(10,40,28,.14);border-radius:18px;padding:12px;box-shadow:0 30px 70px -30px rgba(12,26,20,.5);font:15px/1.45 system-ui}' +
    '#crewHelp[hidden]{display:none}.ch-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}.ch-x{border:0;background:none;font-size:1.5rem;cursor:pointer;color:#3E5248}' +
    '.ch-q{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid rgba(10,40,28,.2);border-radius:12px;font:inherit;margin-bottom:8px}' +
    '#crewHelp details{border-bottom:1px solid rgba(10,40,28,.08);padding:8px 2px}#crewHelp summary{font-weight:700;cursor:pointer}#crewHelp details p{margin:6px 0 0;color:#3E5248}' +
    '.ch-call{display:block;text-align:center;margin-top:10px;padding:10px;border-radius:999px;background:#0C1A14;color:#fff!important;text-decoration:none;font-weight:700}.ch-none{color:#6B7D74}';
  document.head.appendChild(css);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build); else build();
})();
