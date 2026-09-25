with open('public/style.css', 'a') as f:
    f.write("""
.white-nav { background: #ffffff !important; box-shadow: 0 4px 20px rgba(0,0,0,0.05) !important; border-bottom: none !important; }
.dark-text { color: #111827 !important; }
.app-phone-btn { display: flex; align-items: center; gap: 6px; padding: 8px 16px; background: rgba(16, 185, 129, 0.1); color: #10b981; border-radius: 100px; font-weight: 600; text-decoration: none; font-size: 0.9rem; }
.app-login-pill { padding: 8px 24px; background: #111827; color: #ffffff; border-radius: 100px; font-weight: 600; border: none; cursor: pointer; }
.dark-icon { color: #111827 !important; background: transparent !important; border: 1px solid #e5e7eb !important; }

.hero-premium-section { padding: 2rem 1rem; position: relative; }
.hero-badge { display: inline-block; padding: 6px 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 100px; font-size: 0.85rem; font-weight: 600; color: #334155; margin-bottom: 1.5rem; }
.hero-premium-title { font-size: 2.5rem; font-weight: 800; line-height: 1.1; color: #111827; letter-spacing: -0.03em; margin-bottom: 1rem; }
.purple-gradient { background: linear-gradient(135deg, #7c3aed, #4f46e5); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.hero-premium-desc { font-size: 1rem; color: #64748b; line-height: 1.6; margin-bottom: 2rem; }
.hero-premium-actions { display: flex; flex-direction: column; gap: 1rem; }
.hero-cta-btn { padding: 14px 28px; border-radius: 12px; font-weight: 600; font-size: 1rem; text-align: center; cursor: pointer; text-decoration: none; display: inline-block; transition: all 0.25s ease; }
.hero-cta-btn.primary { background: #111827; color: #ffffff; border: none; }
.hero-cta-btn.primary:hover { background: #1f2937; transform: translateY(-2px); }
.hero-cta-btn.secondary { background: #ffffff; color: #111827; border: 1px solid #e2e8f0; }

.hero-premium-illustration { position: relative; margin-top: 3rem; border-radius: 24px; overflow: hidden; }
.illustration-bg { position: absolute; inset: 0; background: radial-gradient(circle at center, rgba(16,185,129,0.1) 0%, transparent 70%); z-index: 1; }
.hero-truck-img { width: 100%; height: auto; border-radius: 24px; position: relative; z-index: 2; display: block; }
.floating-track-card { position: absolute; bottom: 20px; left: 20px; right: 20px; background: rgba(255,255,255,0.95); backdrop-filter: blur(10px); padding: 16px; border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); z-index: 3; }
.track-card-header { font-size: 0.8rem; font-weight: 700; color: #10b981; display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.track-card-plate { font-size: 1.1rem; font-weight: 800; color: #111827; margin-bottom: 4px; }
.track-card-status { font-size: 0.85rem; color: #64748b; }
.track-card-map-mock { height: 60px; background: #e2e8f0; border-radius: 8px; margin-top: 12px; }

.trust-signals-card { display: flex; flex-direction: column; gap: 1rem; padding: 1.5rem; background: #ffffff; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #f1f5f9; margin: 0 1rem 2rem; }
.trust-item { display: flex; align-items: center; gap: 10px; font-size: 0.95rem; font-weight: 600; color: #334155; }
.trust-item i { color: #10b981; }
.trust-divider { display: none; }
""")

with open('public/desktop.css', 'a') as f:
    f.write("""
@media (min-width: 1024px) {
  .hero-premium-section { display: grid; grid-template-columns: 1fr 1fr; gap: 4rem; align-items: center; padding: 4rem 2rem; max-width: 1400px; margin: 0 auto; }
  .hero-premium-title { font-size: 4rem; margin-bottom: 1.5rem; }
  .hero-premium-desc { font-size: 1.1rem; font-weight: 500; }
  .hero-premium-actions { flex-direction: row; gap: 1.5rem; }
  .hero-premium-illustration { margin-top: 0; }
  .floating-track-card { right: auto; width: 320px; left: -30px; bottom: 30px; }

  .trust-signals-card { flex-direction: row; justify-content: space-between; align-items: center; padding: 1.5rem 3rem; border-radius: 100px; margin: -2rem auto 4rem; max-width: 1200px; position: relative; z-index: 10; box-shadow: 0 10px 40px rgba(0,0,0,0.08); }
  .trust-divider { display: block; width: 1px; height: 24px; background: #e2e8f0; }
  .app-phone-btn { display: flex; }
}
""")

with open('public/mobile-fixes.css', 'a') as f:
    f.write("""
@media (max-width: 768px) {
  .desktop-nav-links { display: none !important; }
  .app-phone-btn { display: none; }
  .hero-premium-actions { flex-direction: column; }
  .hero-premium-title { font-size: 2.8rem; }
}
""")

print("CSS added.")
