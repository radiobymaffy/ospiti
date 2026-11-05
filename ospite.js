// Pagina dell'ospite: entra con il link, controlla video e audio, si collega alla diretta.
(() => {
  const L = window.LivekitClient;
  const $ = (s) => document.querySelector(s);
  const el = (tag, attr = {}, ...figli) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attr)) { if (v == null || v === false) continue; if (k === 'class') e.className = v; else if (k === 'testo') e.textContent = v; else e.setAttribute(k, v); }
    for (const f of figli) if (f) e.append(f);
    return e;
  };

  // ---- il link: #t=<accesso>&u=<indirizzo del servizio> ----
  const parametri = new URLSearchParams(location.hash.replace(/^#/, ''));
  let token = parametri.get('t');
  let urlServizio = parametri.get('u');
  // Il codice si toglie dalla barra degli indirizzi, ma si ricorda in questa scheda:
  // così se la pagina si ricarica (il telefono lo fa spesso) non serve riaprire il link.
  try {
    if (token && urlServizio) sessionStorage.setItem('ospite.accesso', JSON.stringify({ t: token, u: urlServizio }));
    else {
      const salvato = JSON.parse(sessionStorage.getItem('ospite.accesso') || 'null');
      if (salvato) { token = salvato.t; urlServizio = salvato.u; }
    }
  } catch { /* niente */ }
  try { history.replaceState(null, '', location.pathname + location.search); } catch { /* niente */ }

  function leggiToken(t) {
    try {
      const b = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(escape(atob(b + '='.repeat((4 - (b.length % 4)) % 4)))));
    } catch { return null; }
  }

  function messaggio(titolo, testo, rientra = false) {
    for (const s of ['#schermataEntra', '#stanza']) $(s).hidden = true;
    $('#schermataMessaggio').hidden = false;
    $('#messaggioTitolo').textContent = titolo;
    $('#messaggioTesto').textContent = testo;
    $('#btnRientra').hidden = !rientra;
  }

  const info = token ? leggiToken(token) : null;
  if (!token || !urlServizio || !info) {
    messaggio('Il link non è completo', 'Prova ad aprirlo di nuovo dal messaggio che ti hanno mandato, oppure chiedi un link nuovo a chi organizza la diretta.');
    return;
  }
  if (info.exp && info.exp * 1000 < Date.now()) {
    messaggio('Il link è scaduto', 'Chiedi un link nuovo a chi organizza la diretta.');
    return;
  }

  // ---- stato ----
  let locali = null;       // { video, audio } tracce locali già create
  let room = null;
  let audioCtx = null;
  let misuraTimer = null;
  let nonLette = 0;
  let mioId = info.sub;
  const pezzi = new Map();   // identity -> { div, video, etichetta, spento }
  const audioEls = new Map();
  let inOnda = [];
  let entrando = false;
  window.__ospite = { get room() { return room; }, audioEls }; // un appiglio per le prove automatiche

  const nomeLink = info.name && info.name !== 'Ospite' ? info.name : '';
  // Il nome scritto nel link vince su quello ricordato (può esserci più di un invito aperto sullo stesso browser).
  $('#nome').value = nomeLink || (() => { try { return localStorage.getItem('ospite.nome') || ''; } catch { return ''; } })();
  if (nomeLink) $('#invito').textContent = `Ciao ${nomeLink}! Sei stato invitato a una diretta. Controlla che ti vedi e ti senti bene, poi premi "Entra".`;
  $('#schermataEntra').hidden = false;

  const messaggioErrore = (e) => {
    if (e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError') return 'Non hai dato il permesso alla telecamera o al microfono. Tocca l\'icona del lucchetto accanto all\'indirizzo (su iPhone: Impostazioni → Safari → Fotocamera e Microfono), scegli "Consenti" e ricarica la pagina.';
    if (e?.name === 'NotFoundError') return 'Non trovo una telecamera o un microfono su questo dispositivo.';
    if (e?.name === 'NotReadableError') return 'La telecamera o il microfono sono usati da un altro programma. Chiudilo e riprova.';
    return e?.message || 'Non riesco ad attivare telecamera e microfono.';
  };

  // ---- anteprima prima di entrare ----
  async function preparaLocali(cameraId, micId) {
    fermaLocali();
    const traccie = await L.createLocalTracks({
      audio: { deviceId: micId || undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: { deviceId: cameraId || undefined, resolution: L.VideoPresets.h720.resolution, facingMode: 'user' },
    });
    locali = { video: traccie.find((t) => t.kind === 'video'), audio: traccie.find((t) => t.kind === 'audio') };
    locali.video.attach($('#anteprima'));
    misura(locali.audio.mediaStreamTrack);
  }

  function fermaLocali() {
    if (!locali) return;
    try { locali.video?.stop(); locali.audio?.stop(); } catch { /* niente */ }
    locali = null;
  }

  function misura(traccia) {
    clearInterval(misuraTimer);
    try {
      audioCtx ||= new AudioContext();
      const an = audioCtx.createAnalyser(); an.fftSize = 512;
      audioCtx.createMediaStreamSource(new MediaStream([traccia])).connect(an);
      const buf = new Float32Array(an.fftSize);
      misuraTimer = setInterval(() => {
        an.getFloatTimeDomainData(buf);
        let s = 0; for (const x of buf) s += x * x;
        $('#livello').style.width = `${Math.min(100, Math.sqrt(s / buf.length) * 320)}%`;
      }, 80);
    } catch { /* niente */ }
  }

  async function riempiScelte() {
    const d = await navigator.mediaDevices.enumerateDevices();
    const cam = d.filter((x) => x.kind === 'videoinput');
    const mic = d.filter((x) => x.kind === 'audioinput' && x.deviceId !== 'default' && x.deviceId !== 'communications');
    const attCam = locali?.video?.mediaStreamTrack.getSettings().deviceId;
    const attMic = locali?.audio?.mediaStreamTrack.getSettings().deviceId;
    const riempi = (sel, lista, att, vuoto) => {
      sel.replaceChildren(...lista.map((x, i) => el('option', { value: x.deviceId, testo: x.label || `${vuoto} ${i + 1}`, selected: x.deviceId === att ? '' : null })));
    };
    riempi($('#selCamera'), cam, attCam, 'Telecamera');
    riempi($('#selMic'), mic, attMic, 'Microfono');
    $('#scelte').hidden = cam.length < 2 && mic.length < 2;
    $('#btnGira').hidden = cam.length < 2;
  }

  async function avviaAnteprima() {
    $('#erroreEntra').textContent = '';
    $('#sopraAnteprima').hidden = true;
    try {
      await preparaLocali($('#selCamera').value || undefined, $('#selMic').value || undefined);
      await riempiScelte();
      $('#btnEntra').disabled = false;
    } catch (e) {
      $('#sopraAnteprima').textContent = messaggioErrore(e);
      $('#sopraAnteprima').hidden = false;
      $('#btnEntra').disabled = true;
    }
  }
  $('#selCamera').addEventListener('change', avviaAnteprima);
  $('#selMic').addEventListener('change', avviaAnteprima);
  avviaAnteprima();

  // ---- entrare ----
  async function entra() {
    const nome = $('#nome').value.trim() || nomeLink || 'Ospite';
    try { localStorage.setItem('ospite.nome', nome); } catch { /* niente */ }
    $('#btnEntra').disabled = true;
    $('#erroreEntra').textContent = 'Mi collego...';
    entrando = true; // finché si sta entrando, una disconnessione non cambia schermata: se qualcosa va storto lo dice il messaggio qui sotto
    try {
      room = new L.Room({ adaptiveStream: true, dynacast: true, publishDefaults: { simulcast: true } });
      collegaEventi();
      await room.connect(urlServizio, token);
      room.startAudio().catch(() => {}); // sblocca l'audio dove si può (iPhone); se non basta compare il tasto "Tocca per attivare l'audio"
      await room.localParticipant.setName(nome).catch(() => {});
      await room.localParticipant.publishTrack(locali.video, { source: L.Track.Source.Camera, name: 'camera' });
      await room.localParticipant.publishTrack(locali.audio, { source: L.Track.Source.Microphone, name: 'microfono' });
      clearInterval(misuraTimer);
      mioId = room.localParticipant.identity;
      $('#schermataEntra').hidden = true;
      $('#schermataMessaggio').hidden = true;
      $('#stanza').hidden = false;
      entrando = false;
      disegnaTutti();
      aggiornaStato();
    } catch (e) {
      entrando = false;
      $('#schermataEntra').hidden = false; $('#stanza').hidden = true; $('#schermataMessaggio').hidden = true; // si torna alla schermata dell'anteprima
      console.warn('Entrata non riuscita:', e);
      // Il motivo vero resta scritto qui sotto "Entra" (prima la disconnessione faceva comparire "Rientra" e lo nascondeva).
      $('#erroreEntra').textContent = /expired|token/i.test(String(e?.message)) ? 'Il link è scaduto: chiedi un link nuovo.' : `Non riesco a entrare: ${e?.message || e?.name || 'riprova tra poco.'}${e?.name && e?.message ? ` (${e.name})` : ''}`;
      $('#btnEntra').disabled = false;
      const stanzaFallita = room; room = null;
      try { stanzaFallita?.removeAllListeners(); await stanzaFallita?.disconnect(false); } catch { /* niente */ } // false: la telecamera dell'anteprima resta accesa per riprovare
      $('#btnAudio').hidden = true;
      for (const z of pezzi.values()) z.div.remove();
      pezzi.clear();
    }
  }
  $('#btnEntra').addEventListener('click', entra);
  $('#nome').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !$('#btnEntra').disabled) entra(); });

  // ---- nella stanza ----
  const nomeMostrato = (p) => (p.identity === 'regia' ? 'Conduttore' : p.name || 'Ospite');

  // Se la regia manda l'USCITA ("In onda": tutto quello che succede in diretta, come lo vedono gli spettatori) l'ospite vede quella, grande,
  // e la propria telecamera in una FINESTRELLA piccola in un angolo (classe "picc"): niente telecamera del conduttore e niente altri ospiti
  // (quando sono in onda li vede dentro l'uscita).
  // Finché l'uscita non c'è (la regia non l'ha ancora mandata, o ha scelto di mandare solo la sua telecamera) restano i riquadri di prima.
  let soloUscita = false;
  const regiaHaUscita = () => {
    const r = room?.remoteParticipants.get('regia');
    return !!r && [...r.trackPublications.values()].some((x) => x.kind === 'video' && x.trackName === 'uscita');
  };

  // Un riquadro per ogni video: uno per persona (e, per la regia, l'USCITA "In onda" oppure la sua telecamera).
  // chiave = identità della persona; z.id = di chi è.
  function pezzo(p, chiave = p.identity) {
    let z = pezzi.get(chiave);
    if (z) return z;
    const video = el('video', { autoplay: '', playsinline: '' });
    video.muted = true;
    const etichetta = el('div', { class: 'etichetta' });
    const spento = el('div', { class: 'spento' });
    const div = el('div', { class: `pezzo ${p.isLocal ? 'io' : ''}` }, video, spento, etichetta);
    z = { div, video, etichetta, spento, id: p.identity };
    pezzi.set(chiave, z);
    $('#griglia').append(div);
    return z;
  }

  function disegna(p, dentro = false) {
    // l'uscita della regia è arrivata (o sparita): cambia chi si vede, quindi si rifanno tutti i riquadri
    const solo = regiaHaUscita();
    if (solo !== soloUscita) { soloUscita = solo; if (!dentro) { disegnaTutti(); return; } }
    const pubs = [...p.trackPublications.values()].filter((x) => x.kind === 'video');
    // cosa mostrare di questa persona: [chiave, pubblicazione video, nome, classe]
    let elenco;
    if (!p.isLocal && p.identity === 'regia') {
      const uscita = pubs.find((x) => x.trackName === 'uscita');
      if (uscita) elenco = [[p.identity, uscita, 'In onda', 'onda']]; // c'è l'uscita: solo quella, anche se la regia mandasse pure la sua telecamera
      else { const sola = pubs.find((x) => x.trackName === 'camera') || pubs[0]; elenco = [[p.identity, sola, 'Conduttore', '']]; }
    } else if (soloUscita) elenco = p.isLocal ? [[p.identity, pubs[0], p.name || 'Tu', 'piccolo']] : []; // con l'uscita: io in piccolo, gli altri non si vedono
    else elenco = [[p.identity, pubs[0], p.isLocal ? `${p.name || 'Tu'} (tu)` : nomeMostrato(p), '']];

    for (const [chiave, pubVideo, nome, classe] of elenco) {
      const z = pezzo(p, chiave);
      z.etichetta.textContent = nome;
      z.spento.textContent = classe === 'onda' ? '▶' : (nome || '?').trim().charAt(0).toUpperCase();
      z.div.classList.toggle('picc', classe === 'piccolo');
      z.div.classList.toggle('onda', classe === 'onda');
      z.div.classList.toggle('cam-conduttore', classe === 'cam-conduttore');
      const traccia = pubVideo?.track;
      if (traccia) { traccia.attach(z.video); }
      z.spento.hidden = !!traccia && !pubVideo.isMuted;
    }
    // i riquadri di questa persona che non servono più (per esempio la regia ha tolto la sua telecamera)
    const chiavi = new Set(elenco.map((e) => e[0]));
    for (const [k, z] of pezzi) if (z.id === p.identity && !chiavi.has(k)) { z.div.remove(); pezzi.delete(k); }

    if (!p.isLocal) {
      const pubAudio = [...p.trackPublications.values()].find((x) => x.kind === 'audio');
      if (pubAudio?.track && !audioEls.has(p.identity)) {
        const a = pubAudio.track.attach();
        a.style.display = 'none';
        document.body.append(a);
        audioEls.set(p.identity, a);
        // se il telefono (iPhone soprattutto) non fa partire l'audio da solo, compare il tasto "Tocca per attivare l'audio"
        setTimeout(() => { if (room && a.isConnected && a.paused) mostraTastoAudio(); }, 1500);
      }
    }
    dimensiona();
  }

  // ---- l'audio può aver bisogno di un tocco (regola di iPhone e Safari) ----
  function mostraTastoAudio() { $('#btnAudio').hidden = false; }
  function aggiornaTastoAudio() { $('#btnAudio').hidden = !room || (room.canPlaybackAudio && [...audioEls.values()].every((a) => !a.paused)); }
  $('#btnAudio').addEventListener('click', async () => {
    try { await room?.startAudio(); } catch { /* niente */ }
    for (const a of audioEls.values()) { try { a.muted = false; await a.play(); } catch { /* niente */ } }
    aggiornaTastoAudio();
  });

  function disegnaTutti() {
    disegna(room.localParticipant, true);
    for (const p of room.remoteParticipants.values()) disegna(p, true);
  }

  function dimensiona() {
    const n = [...pezzi.values()].filter((z) => !z.div.classList.contains('picc')).length; // la finestrella della propria camera non conta: sta sopra, in un angolo
    const verticale = innerHeight > innerWidth && !$('#stanza').classList.contains('oriz');
    const col = verticale ? (n <= 2 ? 1 : 2) : (n <= 1 ? 1 : n <= 4 ? 2 : 3);
    $('#griglia').style.setProperty('--col', String(col));
    // con "In onda" (l'uscita della regia) quel video è grande e gli altri riquadri gli stanno accanto o sotto
    const conOnda = [...pezzi.values()].some((z) => z.div.classList.contains('onda'));
    $('#griglia').classList.toggle('con-onda', conOnda);
    $('#griglia').classList.toggle('solo-onda', conOnda && n === 1); // l'uscita da sola riempie tutto lo spazio (con le bande nere se serve)
    $('#griglia').style.setProperty('--righe', String(Math.max(1, n - 1)));
    $('#griglia').style.setProperty('--col-sotto', String(Math.min(2, Math.max(1, n - 1))));
  }
  // ---- lo schermo in ORIZZONTALE anche con il telefono in piedi ----
  // Il tasto "↻ Orizzontale" gira di un quarto di giro tutta la schermata (utile se il telefono ha il blocco della rotazione): "In onda" diventa
  // più grande, come tenendo il telefono per traverso. "⇄ Altro lato" sceglie da che parte girare il telefono. Se il telefono viene girato davvero
  // (o la rotazione automatica è accesa) la schermata gira da sola e il tasto non serve più. Si ricorda finché la scheda resta aperta.
  let orizzontale = 0; // 0 = come viene; 1 o -1 = girata da una parte o dall'altra
  try { orizzontale = Number(sessionStorage.getItem('ospite.oriz')) || 0; } catch { /* niente */ }
  const salvaOriz = () => { try { sessionStorage.setItem('ospite.oriz', String(orizzontale)); } catch { /* niente */ } };
  function applicaOrizzontale() {
    document.documentElement.style.setProperty('--W', `${innerWidth}px`);
    document.documentElement.style.setProperty('--H', `${innerHeight}px`);
    if (orizzontale && innerWidth > innerHeight) { orizzontale = 0; salvaOriz(); } // il telefono è stato girato davvero: la schermata normale è già per traverso
    const attiva = orizzontale !== 0;
    // schermata "piatta" (girata col tasto, o telefono davvero per traverso): i comandi vanno in una colonna a destra e i chip stanno sopra il video, che prende quasi tutto lo spazio
    $('#stanza').classList.toggle('piatta', attiva || (innerWidth > innerHeight && innerHeight <= 560));
    $('#stanza').classList.toggle('oriz', attiva);
    $('#stanza').classList.toggle('oriz-inv', attiva && orizzontale < 0);
    $('#btnOriz').hidden = !(innerHeight > innerWidth);
    $('#btnOriz').textContent = attiva ? '↻ Verticale' : '↻ Orizzontale';
    $('#btnAltroLato').hidden = !attiva;
    dimensiona();
  }
  $('#btnOriz').addEventListener('click', () => { orizzontale = orizzontale ? 0 : 1; salvaOriz(); applicaOrizzontale(); });
  $('#btnAltroLato').addEventListener('click', () => { orizzontale = -orizzontale; salvaOriz(); applicaOrizzontale(); });
  addEventListener('resize', applicaOrizzontale);
  addEventListener('orientationchange', () => setTimeout(applicaOrizzontale, 150));
  applicaOrizzontale();

  function aggiornaStato() {
    const regiaCollegata = !!room && room.remoteParticipants.has('regia');
    $('#statoStanza').textContent = regiaCollegata ? 'Collegato' : 'In attesa che la regia si colleghi...';
    $('#badgeOnda').hidden = !inOnda.includes(mioId);
  }

  function collegaEventi() {
    const { RoomEvent } = L;
    room.on(RoomEvent.ParticipantConnected, (p) => { disegna(p); aggiornaStato(); });
    room.on(RoomEvent.ParticipantDisconnected, (p) => {
      for (const [k, z] of pezzi) if (z.id === p.identity) { z.div.remove(); pezzi.delete(k); }
      audioEls.get(p.identity)?.remove(); audioEls.delete(p.identity);
      dimensiona(); aggiornaStato(); aggiornaTastoAudio();
    });
    room.on(RoomEvent.AudioPlaybackStatusChanged, () => aggiornaTastoAudio());
    room.on(RoomEvent.TrackSubscribed, (t, pub, p) => disegna(p));
    room.on(RoomEvent.TrackUnsubscribed, (t, pub, p) => { if (t.kind === 'audio') { audioEls.get(p.identity)?.remove(); audioEls.delete(p.identity); } disegna(p); });
    room.on(RoomEvent.TrackUnpublished, (pub, p) => disegna(p)); // la regia ha tolto un video (per esempio la sua telecamera): sparisce anche il riquadro
    room.on(RoomEvent.TrackMuted, (pub, p) => disegna(p));
    room.on(RoomEvent.TrackUnmuted, (pub, p) => disegna(p));
    room.on(RoomEvent.LocalTrackPublished, () => disegna(room.localParticipant));
    room.on(RoomEvent.ParticipantNameChanged, (n, p) => disegna(p));
    room.on(RoomEvent.ActiveSpeakersChanged, (parlanti) => {
      const ids = new Set(parlanti.map((p) => p.identity));
      for (const z of pezzi.values()) z.div.classList.toggle('parla', ids.has(z.id) && !z.div.classList.contains('onda'));
    });
    room.on(RoomEvent.Reconnecting, () => { $('#statoStanza').textContent = 'Connessione persa, riprovo...'; });
    room.on(RoomEvent.Reconnected, () => aggiornaStato());
    room.on(RoomEvent.Disconnected, (motivo) => {
      if (entrando) return; // l'entrata non è riuscita: ci pensa "entra()" a scrivere il motivo e a lasciare la telecamera accesa per riprovare
      fermaLocali();
      window.TimerOspite?.nascondi();
      const R = L.DisconnectReason || {};
      for (const a of audioEls.values()) a.remove();
      audioEls.clear(); pezzi.clear(); $('#griglia').replaceChildren(); $('#btnAudio').hidden = true;
      if (motivo === R.PARTICIPANT_REMOVED) messaggio('Sei uscito dalla diretta', 'La regia ti ha tolto dalla stanza. Se è stato un errore, chiedi un link nuovo.');
      else if (motivo === R.DUPLICATE_IDENTITY) messaggio('Sei entrato da un altro dispositivo', 'Questo link si usa su un dispositivo alla volta. Ogni ospite ha il suo link.');
      else if (motivo === R.ROOM_DELETED) messaggio('La diretta è finita', 'Grazie di avere partecipato!');
      else {
        // il nome del motivo (per esempio "CONNECTION_TIMEOUT") aiuta a capire cosa è successo se il problema si ripete
        const nomeMotivo = Object.entries(R).find(([, v]) => v === motivo)?.[0] || (motivo == null ? '' : String(motivo));
        console.warn('Disconnesso dalla stanza:', motivo, nomeMotivo);
        messaggio('Sei uscito dalla diretta', `Puoi rientrare con lo stesso link, se è ancora valido.${nomeMotivo ? ` (motivo: ${nomeMotivo})` : ''}`, true);
      }
    });
    room.on(RoomEvent.DataReceived, (payload, p, kind, topic) => {
      try {
        const m = JSON.parse(new TextDecoder().decode(payload));
        if (topic === 'stato') { inOnda = Array.isArray(m.inOnda) ? m.inOnda : []; aggiornaStato(); }
        if (topic === 'chat') aggiungiMessaggio(p?.identity === 'regia' ? 'Conduttore' : (p?.name || 'Ospite'), String(m.testo || '').slice(0, 500), false);
        if (topic === 'timer' && p?.identity === 'regia') window.TimerOspite?.ricevi(m); // solo dalla regia, e solo se il conduttore lo permette
      } catch { /* ignorato */ }
    });
  }

  // ---- comandi ----
  $('#btnMic').addEventListener('click', async () => {
    const attivo = room.localParticipant.isMicrophoneEnabled;
    await room.localParticipant.setMicrophoneEnabled(!attivo);
    $('#btnMic').classList.toggle('spento', attivo);
  });
  $('#btnCamera').addEventListener('click', async () => {
    const attivo = room.localParticipant.isCameraEnabled;
    await room.localParticipant.setCameraEnabled(!attivo);
    $('#btnCamera').classList.toggle('spento', attivo);
    disegna(room.localParticipant);
  });
  $('#btnGira').addEventListener('click', async () => {
    const cam = (await navigator.mediaDevices.enumerateDevices()).filter((x) => x.kind === 'videoinput');
    const attuale = room.localParticipant.getTrackPublication(L.Track.Source.Camera)?.track?.mediaStreamTrack.getSettings().deviceId;
    const i = cam.findIndex((x) => x.deviceId === attuale);
    const prossima = cam[(i + 1) % cam.length];
    if (prossima) await room.switchActiveDevice('videoinput', prossima.deviceId);
  });
  $('#btnEsci').addEventListener('click', async () => { if (confirm('Vuoi uscire dalla diretta?')) await room.disconnect(); });
  $('#btnRientra').addEventListener('click', () => location.reload());

  function aggiungiMessaggio(da, testo, mio) {
    const lista = $('#chatLista');
    lista.append(el('div', { class: `msg ${mio ? 'mio' : ''}` }, el('b', { testo: mio ? 'Tu' : da }), el('span', { testo })));
    lista.scrollTop = lista.scrollHeight;
    if (!mio && $('#chat').hidden) { nonLette += 1; $('#nonLette').textContent = String(nonLette); $('#nonLette').hidden = false; }
  }
  $('#btnChat').addEventListener('click', () => {
    if (orizzontale && $('#chat').hidden) { orizzontale = 0; salvaOriz(); applicaOrizzontale(); } // scrivere con la tastiera a schermo gira male: per i messaggi si torna in piedi
    $('#chat').hidden = !$('#chat').hidden;
    if (!$('#chat').hidden) { nonLette = 0; $('#nonLette').hidden = true; $('#chatTesto').focus(); }
  });
  $('#chatForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const t = $('#chatTesto').value.trim();
    if (!t || !room) return;
    await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ testo: t })), { reliable: true, topic: 'chat' });
    aggiungiMessaggio('Tu', t, true);
    $('#chatTesto').value = '';
  });

  addEventListener('pagehide', () => { try { room?.disconnect(); } catch { /* niente */ } });
})();
