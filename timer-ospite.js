// Il timer che la regia fa vedere agli ospiti. Compare solo se il conduttore lo permette (spunta "Mostra il timer agli ospiti")
// e sparisce da solo se la regia non si fa più sentire. Arriva dalla stanza con messaggi "timer", circa uno al secondo.
(() => {
  let ultimo = null; // { m: messaggio della regia, quando: istante in cui è arrivato }
  const due = (n) => String(n).padStart(2, '0');
  function formatta(sec) {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60);
    return h ? `${h}:${due(m)}:${due(s % 60)}` : `${due(m)}:${due(s % 60)}`;
  }

  // il valore di adesso: il messaggio dice com'era un attimo fa e se sta andando, così tra un messaggio e l'altro il conto prosegue da solo
  function valoreMs() {
    const { m, quando } = ultimo;
    const passato = m.acceso ? performance.now() - quando : 0;
    if (m.modo === 'giu') return Math.max(0, m.valoreMs - passato);
    const v = m.valoreMs + passato;
    return m.durataMs > 0 ? Math.min(v, m.durataMs) : v;
  }

  function disegna() {
    const box = document.querySelector('#timerOspite');
    if (!box) return;
    const visibile = !!(ultimo && ultimo.m.mostra && performance.now() - ultimo.quando < 5000);
    box.hidden = !visibile;
    if (!visibile) return;
    const m = ultimo.m;
    const v = valoreMs();
    const sec = m.modo === 'giu' ? Math.ceil(v / 1000) : Math.floor(v / 1000);
    const finito = !!m.concluso || (m.acceso && m.modo === 'giu' && v <= 0); // a zero la regia lo dice con "concluso"; nell'attimo prima del suo messaggio si vede già zero
    box.querySelector('b').textContent = formatta(sec);
    box.classList.toggle('ultimi', m.modo === 'giu' && m.acceso && sec <= 10 && sec > 0);
    box.classList.toggle('finito', finito);
    box.classList.toggle('fermo', !m.acceso && !finito);
  }

  window.TimerOspite = {
    ricevi(m) { ultimo = m && typeof m === 'object' ? { m, quando: performance.now() } : null; disegna(); },
    nascondi() { ultimo = null; disegna(); },
  };
  setInterval(disegna, 250);
})();
