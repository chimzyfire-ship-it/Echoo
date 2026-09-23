/* Account-level first-use only. No local-storage flag and no preference writes. */
(() => {
  'use strict';
  if (window.EchooFirstUse) return;
  let running = false;
  window.EchooFirstUse = { start };
  async function start(state) {
    if (running || !state?.ok || !state.user?.id) return;
    running = true;
    if (document.readyState === 'loading') await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    const steps = [
      ['#plan-form', 'Start with a feeling.', 'Ask Echoo for a plan. Your interests, budget and pace help shape the suggestions.'],
      ['#search-form', 'Follow your curiosity.', 'Search for a place or activity. Explore what fits your mood and make it part of your day.'],
      ['.bottom-nav a[href="events.html"]', 'Find your kind of place.', 'Discover places and activities worth stepping out for.'],
      ['.bottom-nav a[href="linkup.html"]', 'Make room for connection.', 'Meet people with shared interests through Link Up. You choose when to connect.'],
      ['.bottom-nav a[href="auth.html"]', 'Your taste can change.', 'Update your preferences in your profile. Echoo can keep up with what feels like you.'],
    ].map(([selector, title, body]) => ({ element: document.querySelector(selector), title, body }))
      .filter(step => step.element && step.element.getClientRects().length);
    // Leave eligibility untouched on pages without a useful tour surface.
    if (!steps.length) { running = false; return; }
    try {
      const { data, error } = await window.EchooAuth.client.rpc('claim_first_use_walkthrough');
      if (error || data !== true) return;
      const { data: auth } = await window.EchooAuth.client.auth.getSession();
      if (auth.session?.user.id !== state.user.id) return;
      show(state, steps);
    } catch (_) { /* A nonessential introduction must never block the app. */ }
  }
  function show(state, steps) {
    const previousFocus = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'echoo-first-use';
    dialog.setAttribute('aria-labelledby', 'echoo-tour-title');
    dialog.setAttribute('aria-describedby', 'echoo-tour-body');
    const scrim = document.createElement('div'); scrim.className = 'echoo-tour-scrim';
    const ring = document.createElement('div'); ring.className = 'echoo-tour-ring'; ring.setAttribute('aria-hidden', 'true');
    const card = document.createElement('section'); card.className = 'echoo-tour-card';
    dialog.append(scrim, ring, card);
    document.body.append(dialog);
    let step = -1;
    let frame = 0;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const subscription = window.EchooAuth.client.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id !== state.user.id) close();
    });
    const resize = new ResizeObserver(schedulePosition);
    resize.observe(card);
    steps.forEach(({ element }) => resize.observe(element));
    window.addEventListener('resize', schedulePosition);
    window.addEventListener('scroll', schedulePosition, true);
    window.visualViewport?.addEventListener('resize', schedulePosition);
    window.visualViewport?.addEventListener('scroll', schedulePosition);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    function close() {
      cancelAnimationFrame(frame);
      resize.disconnect();
      subscription.data.subscription.unsubscribe();
      window.removeEventListener('resize', schedulePosition);
      window.removeEventListener('scroll', schedulePosition, true);
      window.visualViewport?.removeEventListener('resize', schedulePosition);
      window.visualViewport?.removeEventListener('scroll', schedulePosition);
      document.body.style.overflow = oldOverflow;
      dialog.close(); dialog.remove();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    }
    function schedulePosition() { cancelAnimationFrame(frame); frame = requestAnimationFrame(position); }
    function position() {
      if (step < 0) return;
      const rect = steps[step].element.getBoundingClientRect();
      const viewport = window.visualViewport;
      const width = viewport?.width || window.innerWidth;
      const height = viewport?.height || window.innerHeight;
      const vx = viewport?.offsetLeft || 0, vy = viewport?.offsetTop || 0;
      const left = Math.max(vx + 8, rect.left - 8), top = Math.max(vy + 8, rect.top - 8);
      const right = Math.min(vx + width - 8, rect.right + 8), bottom = Math.min(vy + height - 8, rect.bottom + 8);
      const visible = right > left && bottom > top;
      ring.hidden = !visible; scrim.hidden = visible;
      Object.assign(ring.style, { left: `${left}px`, top: `${top}px`, width: `${Math.max(0, right - left)}px`, height: `${Math.max(0, bottom - top)}px` });
      card.style.width = `${Math.min(440, width - 32)}px`;
      const above = top - vy - 32, below = vy + height - bottom - 32;
      const useAbove = above > below;
      card.style.maxHeight = `${Math.max(100, visible ? Math.max(above, below) : height - 32)}px`;
      card.style.left = `${vx + Math.max(16, Math.min(width - card.offsetWidth - 16, rect.left - vx))}px`;
      card.style.top = `${visible ? (useAbove ? Math.max(vy + 16, top - card.offsetHeight - 16) : bottom + 16) : vy + 16}px`;
    }
    function node(tag, text, className) {
      const el = document.createElement(tag); el.textContent = text;
      if (className) el.className = className;
      return el;
    }
    function button(text, action, className) {
      const el = node('button', text, className); el.type = 'button'; el.addEventListener('click', action); return el;
    }
    function render() {
      card.replaceChildren();
      card.className = step < 0 ? 'echoo-tour-completion' : 'echoo-tour-card';
      card.removeAttribute('style');
      ring.hidden = step < 0;
      scrim.hidden = step < 0;
      const content = step < 0 ? node('div', '', 'echoo-tour-completion-inner') : card;
      if (step < 0) {
        const success = node('div', '', 'echoo-tour-success');
        success.setAttribute('aria-hidden', 'true');
        success.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18 18 6M6 6h12v12"/></svg>';
        content.append(success);
      }
      content.append(node('div', step < 0 ? 'ONBOARDING COMPLETE' : `YOUR ECHOO · ${step + 1} / ${steps.length}`, 'echoo-tour-eyebrow'));
      const title = node('h2', step < 0 ? 'A little more you. A lot more possibility.' : steps[step].title);
      title.id = 'echoo-tour-title'; title.tabIndex = -1;
      const body = node('p', step < 0 ? `Your interests, your pace, your kind of plans. Echoo uses what you shared to personalise suggestions around ${state.preferences?.city || 'your city'}.` : steps[step].body);
      body.id = 'echoo-tour-body';
      content.append(title, body);
      if (step < 0) {
        const signals = node('div', '', 'echoo-tour-signals');
        [state.profile?.interests?.[0], state.profile?.budget, state.profile?.energy === 'chill' ? 'Easygoing' : state.profile?.energy === 'hype' ? 'Social energy' : 'Room to explore'].filter(Boolean).forEach(label => signals.append(node('span', label)));
        content.append(signals, node('p', 'Always yours to change in your profile.', 'echoo-tour-note'));
      }
      content.append(button(step < 0 ? 'Show me around' : step === steps.length - 1 ? 'Make yourself at home' : 'Next', () => {
        if (step === steps.length - 1) close(); else { step++; render(); }
      }, 'echoo-tour-next'));
      const actions = node('div', '', 'echoo-tour-actions');
      if (step >= 0) actions.append(button('Back', () => { step--; render(); }, 'echoo-tour-quiet'));
      actions.append(button(step < 0 ? 'Explore on my own' : 'Skip tour', close, 'echoo-tour-quiet'));
      content.append(actions);
      if (step < 0) card.append(content);
      else { steps[step].element.scrollIntoView({ block: 'center', behavior: 'instant' }); position(); }
      title.focus({ preventScroll: true });
    }
    dialog.showModal();
    render();
  }
})();
