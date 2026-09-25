import re

with open('public/index.html', 'r') as f:
    content = f.read()

search_html = """    <!-- Hero Card (replaces full-screen hero) -->
    <div class="hero-app-card" style="background-image: url('images/mainbackground.jpg')">
      <div class="hero-app-overlay"></div>
      <div class="hero-app-content">
      <div class="hero-trust-pill">
    <span class="trust-dot"></span>
    <span class="hero-trust-text">
        Trusted Packers & Movers in Bangalore
    </span>
</div>
      <h1 class="hero-app-title">
    Move Smarter<br>
    Across Bangalore
</h1>
        <p class="hero-location">
    <i data-lucide="map-pin"></i> Serving all areas across Bangalore
</p>
        <p class="hero-app-sub">
    Live GPS Tracking • Fully Insured • Zero Damage Guarantee
</p>
        <a href="#quote" class="hero-cta-btn" onclick="openBookingSheet()">
          Get Instant Quote
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </a>
      </div>
    </div>

    <div class="hero-trust-row" style="background: var(--bg-primary); padding: 1.5rem 1rem; margin-bottom: 1rem; border-bottom: 1px solid var(--border-light); display: flex; justify-content: space-around; align-items: center; box-shadow: var(--shadow-sm);">
        <span class="trust-chip" style="color: var(--text-primary); font-size: 0.9rem; font-weight: 700; background: transparent;"><span style="font-size: 1.2rem; margin-right: 4px; color: var(--green-600);"><i data-lucide="shield-check"></i></span> Fully Insured</span>
        <span class="trust-chip" style="color: var(--text-primary); font-size: 0.9rem; font-weight: 700; background: transparent;"><span style="font-size: 1.2rem; margin-right: 4px; color: var(--green-600);"><i data-lucide="map-pin"></i></span> Live GPS</span>
        <span class="trust-chip" style="color: var(--text-primary); font-size: 0.9rem; font-weight: 700; background: transparent;"><span style="font-size: 1.2rem; margin-right: 4px; color: var(--green-600);"><i data-lucide="check-circle"></i></span> Zero Damage</span>
    </div>"""

replace_html = """   <div class="hero-premium-section">
     <div class="hero-premium-content">
       <div class="hero-badge">⭐ Bangalore's Most Trusted Packers & Movers</div>
       <h1 class="hero-premium-title">Move Smarter.<br><span class="purple-gradient">Move Safer.</span></h1>
       <p class="hero-premium-desc">Instant Pricing • Live GPS Tracking • Insured Transport • Verified Professionals</p>
       <div class="hero-premium-actions">
         <button class="hero-cta-btn primary" onclick="openBookingSheet()">Get Instant Quote</button>
         <a href="#services" class="hero-cta-btn secondary">View Services</a>
       </div>
     </div>
     <div class="hero-premium-illustration">
       <div class="illustration-bg"></div>
       <img src="images/service-truck.jpg" alt="Moving Truck" class="hero-truck-img">
       <div class="floating-track-card">
         <div class="track-card-header"><i data-lucide="map-pin"></i> Live Tracking</div>
         <div class="track-card-plate">KA 51 AB 1234</div>
         <div class="track-card-status">On the way to destination</div>
         <div class="track-card-map-mock"></div>
       </div>
     </div>
   </div>
   <div class="trust-signals-card">
     <div class="trust-item"><i data-lucide="star"></i> 4.9/5 Customer Rating</div>
     <div class="trust-divider"></div>
     <div class="trust-item"><i data-lucide="shield-check"></i> Insured Moves</div>
     <div class="trust-divider"></div>
     <div class="trust-item"><i data-lucide="map-pin"></i> Live GPS Tracking</div>
     <div class="trust-divider"></div>
     <div class="trust-item"><i data-lucide="credit-card"></i> Secure Payments</div>
     <div class="trust-divider"></div>
     <div class="trust-item"><i data-lucide="award"></i> Trusted Across Bangalore</div>
   </div>"""

if search_html in content:
    content = content.replace(search_html, replace_html)
    with open('public/index.html', 'w') as f:
        f.write(content)
    print("Success")
else:
    print("Failed to find search_html")
