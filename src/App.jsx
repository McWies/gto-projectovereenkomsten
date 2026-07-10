import { useState, useEffect, useRef } from 'react'
import { getData, saveData, uid } from './data'
import './App.css'

const ENTS = {
  nl: { naam: 'GTO Nederland', kvknr: '66192374', btwnr: 'NL856435703B01', adres: 'Europaplein 1, 5684 ZC Best', email: 'info@gtonederland.nl', web: 'www.gtonederland.nl', signer_zzp: 'J. Janssen', signer_klant: 'J.M.P.H. Janssen', fmail: 'facturen@gtonederland.nl', logo: '/logo-nederland.jpg', model_ref: 'nr: 90821.25537.3.0 | 30-04-2021 van de belastingdienst', bedrijfsnaam_zzp: 'Gras Technische Ondersteuning B.V.', bedrijfsnaam_klant: 'Gras Technische Ondersteuning B.V.', persnr_prefix: '' },
  west: { naam: 'GTO West', kvknr: '72180080', btwnr: 'NL859017898B01', adres: 'Europaplein 1, 5684 ZC Best', email: 'info@gtowest.nl', web: 'www.gtonederland.nl', signer_zzp: 'E. Gras', signer_klant: 'i.o. D.M. van Lith', fmail: 'facturen@gtowest.nl', logo: '/logo-west.jpg', model_ref: 'nr: 90821.25537.3.0 | 30-04-2021 van de belastingdienst', bedrijfsnaam_zzp: 'Gras Technical Support west B.V.', bedrijfsnaam_klant: 'Gras Technical Support west B.V.', persnr_prefix: 'W' }
}

// Backend API voor het genereren van Word/PDF overeenkomsten (Render)
const API_URL = 'https://gto-overeenkomsten-backend.onrender.com'

// Converteer NL datumformaat (DD-MM-JJJJ uit form.start) naar de twee formaten die de backend nodig heeft
function dateToNl(isoDate) {
  if (!isoDate) return ''
  const [y, m, d] = isoDate.split('-')
  return `${d}-${m}-${y}`
}

async function validateOvereenkomst({ ent, selKlant, selProj, selMons }) {
  const tb = selKlant.tekenbevoegden.find(t => t.id === selProj.tb_id) || selKlant.tekenbevoegden[0] || { naam: '' }

  const payload = {
    entiteit: ent,
    monteurs: selMons.map(m => ({
      id: m.id, naam: m.naam, handelsnaam: m.handelsnaam, kvk: m.kvk,
      adres: m.adres || '', persnr: getPersnr(m, ent),
    })),
    klant: { naam: selKlant.naam, adres: selKlant.adres, kvk: selKlant.kvk },
    project: { nr: selProj.nr, naam: selProj.naam || '', werkadres: selProj.werkadres || '' },
    tekenbevoegde: tb.naam,
    opdrachtomschrijving: selProj.omschr || '',
  }

  try {
    const res = await fetch(`${API_URL}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) return { compleet: true, ontbrekend: [] } // bij serverfout niet blokkeren
    return await res.json()
  } catch (e) {
    return { compleet: true, ontbrekend: [] } // bij netwerkfout niet blokkeren, /generate vangt het alsnog op
  }
}

async function downloadOvereenkomsten({ ent, selKlant, selProj, selMons, form, tarieven, toast }) {
  const tb = selKlant.tekenbevoegden.find(t => t.id === selProj.tb_id) || selKlant.tekenbevoegden[0] || { naam: '' }
  await downloadOvereenkomstenMet({ ent, selKlant, selProj, selMons, form, tarieven, tbNaam: tb.naam, toast, db })
}

async function downloadOvereenkomstenMet({ ent, selKlant, selProj, selMons, form, tarieven, tbNaam, toast, db }) {
  const persoonsnummerVoorMonteur = (m) => getPersnr(m, ent)

  const monteursPayload = selMons.map(m => ({
    id: m.id,
    naam: m.naam,
    handelsnaam: m.handelsnaam,
    kvk: m.kvk,
    adres: m.adres || '',
    persnr: persoonsnummerVoorMonteur(m),
  }))

  const tarievenPayload = {}
  selMons.forEach(m => {
    tarievenPayload[m.id] = {
      zzp: tarieven[`${m.id}_zzp`] || '',
      klant: tarieven[`${m.id}_kl`] || '',
      reisuur: tarieven[`${m.id}_reis`] || '',
    }
  })

  const payload = {
    entiteit: ent,
    monteurs: monteursPayload,
    klant: {
      naam: selKlant.naam,
      adres: selKlant.adres,
      kvk: selKlant.kvk,
      btw: selKlant.btw || '',
      contact: selKlant.contact || '',
      fmail: selKlant.fmail || '',
    },
    project: {
      nr: selProj.nr,
      naam: selProj.naam || '',
      werkadres: selProj.werkadres || '',
    },
    tekenbevoegde: tbNaam || '',
    startdatum_nl: dateToNl(form.start),
    startdatum_iso: form.start || new Date().toISOString().slice(0, 10),
    handtekendatum_nl: dateToNl(form.signdate),
    tarieven_per_monteur: tarievenPayload,
    opdrachtomschrijving: form.omschr || selProj.omschr || '',
    // Stuur de juiste voorwaarden mee (klant-override of standaard)
    artikelen: {
      [`${ent}_zzp`]:   (db?.standaard_voorwaarden || {})[`${ent}_zzp`] || [],
      [`${ent}_klant`]: (selKlant.voorwaarden_override?.[`${ent}_klant`]) ||
                        (db?.standaard_voorwaarden || {})[`${ent}_klant`] || [],
    },
  }

  toast('Overeenkomsten worden gegenereerd...')

  try {
    const res = await fetch(`${API_URL}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      toast(`Fout: ${err.error || 'genereren mislukt'}`)
      return
    }

    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Overeenkomsten ${selKlant.naam} ${selProj.nr}.zip`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast('Download gestart ✓')
  } catch (e) {
    toast('Kon geen verbinding maken met de generator. Probeer het zo nogmaals (server kan opstarten).')
  }
}

function av(naam) { return (naam || '??').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() }
function fmtDate(v) { if (!v) return '[datum]'; const [y, m, d] = v.split('-'); return `${d}-${m}-${y}` }
function fmtEuro(v) { if (!v || isNaN(v)) return '[tarief]'; return '€ ' + parseFloat(v).toFixed(2) }

// Haal het juiste persoonsnummer op voor een monteur in een entiteit
function getPersnr(mon, ent) {
  if (ent === 'west') return mon.persnr_west || mon.persnr || ''
  return mon.persnr_nl || mon.persnr || ''
}

function isWestPersnr(persnr) { return persnr && persnr.toString().startsWith('W') }

export default function App() {
  const [db, setDb] = useState(null)
  const [screen, setScreen] = useState('dashboard')
  const [notify, setNotify] = useState('')

  useEffect(() => { setDb(getData()) }, [])

  function save(newDb) { setDb({ ...newDb }); saveData(newDb) }
  function toast(msg) { setNotify(msg); setTimeout(() => setNotify(''), 2800) }

  if (!db) return <div style={{ padding: 40, fontFamily: 'Arial' }}>Laden...</div>

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sb-logo">
          <img src="/logo-nederland.jpg" alt="GTO" style={{ height: 40, objectFit: 'contain' }} />
          <div><div className="sb-name">Overeenkomsten</div><div className="sb-sub">Beheerplatform</div></div>
        </div>
        <div className="nav-sec">Menu</div>
        {[['dashboard','Dashboard'],['nieuw','Nieuwe overeenkomst']].map(([id, lbl]) =>
          <div key={id} className={`nav-item ${screen === id ? 'active' : ''}`} onClick={() => setScreen(id)}>
            <span className="nav-dot" />{lbl}
          </div>
        )}
        <div className="nav-sec">Beheer</div>
        {[['monteurs','Monteurs'],['klanten','Klanten & projecten'],['voorwaarden','Voorwaarden'],['instellingen','Instellingen']].map(([id, lbl]) =>
          <div key={id} className={`nav-item ${screen === id ? 'active' : ''}`} onClick={() => setScreen(id)}>
            <span className="nav-dot" />{lbl}
          </div>
        )}
      </aside>

      <div className="main">
        <div className="topbar">
          <div>
            <div className="tb-title">{{ dashboard:'Dashboard', nieuw:'Nieuwe overeenkomst', monteurs:'Monteurs', klanten:'Klanten & projecten', voorwaarden:'Voorwaarden beheren', instellingen:'Instellingen' }[screen]}</div>
            <div className="tb-sub">GTO Overeenkomsten Platform</div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setScreen('nieuw')}>+ Nieuwe overeenkomst</button>
        </div>
        <div className="content">
          {screen === 'dashboard'    && <Dashboard db={db} setScreen={setScreen} />}
          {screen === 'nieuw'        && <NieuweOvereenkomst db={db} save={save} toast={toast} />}
          {screen === 'monteurs'     && <MonteursScreen db={db} save={save} toast={toast} />}
          {screen === 'klanten'      && <KlantenScreen db={db} save={save} toast={toast} />}
          {screen === 'voorwaarden'   && <VoorwaardenScreen db={db} save={save} toast={toast} />}
          {screen === 'instellingen' && <InstellingenScreen db={db} save={save} toast={toast} />}
        </div>
      </div>
      {notify && <div className="toast">{notify}</div>}
    </div>
  )
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────
function Dashboard({ db, setScreen }) {
  const totalProj = db.klanten.reduce((a, k) => a + k.projecten.length, 0)
  return (
    <div>
      <div className="stat-grid">
        <div className="stat"><div className="stat-val">{db.monteurs.length}</div><div className="stat-lbl">Monteurs</div></div>
        <div className="stat"><div className="stat-val">{db.klanten.length}</div><div className="stat-lbl">Klanten</div></div>
        <div className="stat"><div className="stat-val">{totalProj}</div><div className="stat-lbl">Projecten</div></div>
        <div className="stat"><div className="stat-val">{db.recent.length}</div><div className="stat-lbl">Gegenereerd</div></div>
      </div>
      <div className="card">
        <div className="card-hdr"><span>Recente overeenkomsten</span></div>
        {!db.recent.length
          ? <div className="empty">Nog geen overeenkomsten gegenereerd. <span className="link" onClick={() => setScreen('nieuw')}>Start hier →</span></div>
          : db.recent.slice(-10).reverse().map(r => (
            <div key={r.id} className="list-item">
              <div className="av av-or">{av(r.monteur)}</div>
              <div className="pinfo"><div className="pname">{r.monteur} — {r.klant}</div><div className="psub">{r.projnr} · {r.entiteit} · {r.datum}</div></div>
            </div>
          ))
        }
      </div>
    </div>
  )
}

// ── NIEUWE OVEREENKOMST ───────────────────────────────────────────────────
function NieuweOvereenkomst({ db, save, toast }) {
  const [step, setStep] = useState(1)
  const [ent, setEnt] = useState('nl')
  const [selKlant, setSelKlant] = useState(null)
  const [selProj, setSelProj] = useState(null)
  const [selMons, setSelMons] = useState([])
  const [form, setForm] = useState({ start: '', signdate: '', omschr: '' })
  const [tarieven, setTarieven] = useState({})
  const [zoekKlant, setZoekKlant] = useState('')
  const [zoekMon, setZoekMon] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [ontbrekendModal, setOntbrekendModal] = useState(null)
  const [ontbrekendInputs, setOntbrekendInputs] = useState({})
  const [nieuwProjModal, setNieuwProjModal] = useState(false)
  const [nieuwProjForm, setNieuwProjForm] = useState({ nr: '', naam: '', werkadres: '', omschr: '', tb_id: '' })
  const [tbDropdownOpen, setTbDropdownOpen] = useState(false)
  const [nieuwTbInput, setNieuwTbInput] = useState('')
  const [nieuwTbMode, setNieuwTbMode] = useState(false)
  // Bewerkbaar overzicht state — gespiegeld vanuit selKlant/selProj/selMons
  const [overzicht, setOverzicht] = useState(null)
  const topRef = useRef(null)

  const e = ENTS[ent]

  function scrollTop() { topRef.current?.scrollIntoView({ behavior: 'smooth' }) }
  function goStep(n) { setStep(n); scrollTop() }

  function pickKlant(k) {
    const fresh = db.klanten.find(x => x.id === k.id) || k
    setSelKlant(fresh); setSelProj(null)
  }
  function pickProj(p) {
    setSelProj(p)
    setForm(f => ({ ...f, omschr: p.omschr || '' }))
  }
  function toggleMon(m) {
    setSelMons(prev => prev.find(x => x.id === m.id) ? prev.filter(x => x.id !== m.id) : [...prev, m])
  }
  function setTarief(monId, field, val) { setTarieven(t => ({ ...t, [`${monId}_${field}`]: val })) }

  // ── Nieuw project aanmaken vanuit stap 2 ──────────────────────────────────
  function openNieuwProj() {
    setNieuwProjForm({ nr: '', naam: '', werkadres: '', omschr: '', tb_id: selKlant?.tekenbevoegden[0]?.id || '' })
    setNieuwProjModal(true)
  }
  function saveNieuwProj() {
    if (!nieuwProjForm.nr || !nieuwProjForm.naam) return
    const nieuwProj = { ...nieuwProjForm, id: uid(), tb_id: parseInt(nieuwProjForm.tb_id) || nieuwProjForm.tb_id }
    const klanten = db.klanten.map(k => k.id === selKlant.id ? { ...k, projecten: [...k.projecten, nieuwProj] } : k)
    const newDb = { ...db, klanten }
    save(newDb)
    const updatedKlant = klanten.find(k => k.id === selKlant.id)
    setSelKlant(updatedKlant)
    pickProj(nieuwProj)
    setNieuwProjModal(false)
    toast('Project aangemaakt en geselecteerd')
  }

  // ── Persoonsnummer bij monteur direct opslaan ──────────────────────────────
  function savePersnrInOverzicht(monId, waarde) {
    if (!waarde.trim()) return
    const nr = waarde.trim()
    const field = ent === 'west' ? 'persnr_west' : 'persnr_nl'
    const monteurs = db.monteurs.map(m => m.id === monId ? { ...m, [field]: nr, persnr: nr } : m)
    save({ ...db, monteurs })
    setSelMons(prev => prev.map(m => m.id === monId ? { ...m, [field]: nr, persnr: nr } : m))
    if (overzicht) {
      setOverzicht(ov => ({ ...ov, monteurs: ov.monteurs.map(m => m.id === monId ? { ...m, [field]: nr, persnr: nr } : m) }))
    }
  }

  // ── Stap 4 → 5: bouw bewerkbaar overzicht ─────────────────────────────────
  function buildOverzicht() {
    const tb = selKlant.tekenbevoegden.find(t => t.id === selProj.tb_id) || selKlant.tekenbevoegden[0] || null
    setOverzicht({
      entiteit: ent,
      klant: { ...selKlant },
      project: { ...selProj },
      tekenbevoegde: tb ? { ...tb } : null,
      monteurs: selMons.map(m => ({ ...m })),
      startdatum: form.start,
      signdate: form.signdate,
      omschr: form.omschr || selProj.omschr || '',
      tarieven: { ...tarieven },
    })
    goStep(5)
  }

  // ── Overzicht: sla gewijzigd veld op én in profiel ────────────────────────
  function updateOv(path, value) {
    setOverzicht(ov => {
      const parts = path.split('.')
      if (parts.length === 1) return { ...ov, [parts[0]]: value }
      if (parts.length === 2) return { ...ov, [parts[0]]: { ...ov[parts[0]], [parts[1]]: value } }
      if (parts[0] === 'monteur') {
        const [, monId, field] = parts
        return { ...ov, monteurs: ov.monteurs.map(m => m.id === parseInt(monId) ? { ...m, [field]: value } : m) }
      }
      return ov
    })
  }

  function syncOverzichtNaarDb() {
    if (!overzicht) return { newDb: db, updatedKlant: selKlant, updatedProj: selProj, updatedMons: selMons }
    let newDb = { ...db }

    // Sync klant
    const klantUpdates = {}
    const klantVelden = ['naam','adres','kvk','btw','contact','fmail','betaling','opzeg']
    klantVelden.forEach(f => { if (overzicht.klant[f] !== undefined) klantUpdates[f] = overzicht.klant[f] })
    let klanten = newDb.klanten.map(k => k.id === selKlant.id ? { ...k, ...klantUpdates } : k)

    // Sync project
    const projUpdates = { naam: overzicht.project.naam, nr: overzicht.project.nr, werkadres: overzicht.project.werkadres, omschr: overzicht.omschr }
    if (overzicht.tekenbevoegde) projUpdates.tb_id = overzicht.tekenbevoegde.id
    klanten = klanten.map(k => {
      if (k.id !== selKlant.id) return k
      const projecten = k.projecten.map(p => p.id === selProj.id ? { ...p, ...projUpdates } : p)
      return { ...k, projecten }
    })

    // Sync tekenbevoegde (nieuw of bestaand)
    if (overzicht.tekenbevoegde && !selKlant.tekenbevoegden.find(t => t.id === overzicht.tekenbevoegde.id)) {
      klanten = klanten.map(k => {
        if (k.id !== selKlant.id) return k
        const tekenbevoegden = [...k.tekenbevoegden, overzicht.tekenbevoegde]
        const projecten = k.projecten.map(p => p.id === selProj.id ? { ...p, tb_id: overzicht.tekenbevoegde.id } : p)
        return { ...k, tekenbevoegden, projecten }
      })
    }

    // Sync monteurs
    let monteurs = newDb.monteurs
    overzicht.monteurs.forEach(om => {
      monteurs = monteurs.map(m => {
        if (m.id !== om.id) return m
        const persnrField = ent === 'west' ? 'persnr_west' : 'persnr_nl'
        return { ...m, naam: om.naam, handelsnaam: om.handelsnaam, kvk: om.kvk, adres: om.adres, [persnrField]: om.persnr || getPersnr(om, ent) }
      })
    })

    newDb = { ...newDb, klanten, monteurs }
    const updatedKlant = klanten.find(k => k.id === selKlant.id)
    const updatedProj = updatedKlant?.projecten.find(p => p.id === selProj.id)
    const updatedMons = overzicht.monteurs.map(om => monteurs.find(m => m.id === om.id) || om)

    save(newDb)
    setSelKlant(updatedKlant)
    setSelProj(updatedProj)
    setSelMons(updatedMons)

    return { newDb, updatedKlant, updatedProj, updatedMons }
  }

  // ── Tekenbevoegde koppelen via dropdown ───────────────────────────────────
  function kiesTekenbevoegde(tb) {
    updateOv('tekenbevoegde', tb)
    setTbDropdownOpen(false)
    setNieuwTbMode(false)
  }
  function voegNieuweTbToe() {
    if (!nieuwTbInput.trim()) return
    const nieuwTb = { id: uid(), naam: nieuwTbInput.trim(), functie: 'Tekenbevoegde' }
    // Voeg meteen toe aan de klant in db
    const klanten = db.klanten.map(k => k.id === selKlant.id ? { ...k, tekenbevoegden: [...k.tekenbevoegden, nieuwTb] } : k)
    save({ ...db, klanten })
    setSelKlant(klanten.find(k => k.id === selKlant.id))
    kiesTekenbevoegde(nieuwTb)
    setNieuwTbInput('')
  }

  // ── Download ──────────────────────────────────────────────────────────────
  async function handleDownload() {
    if (!overzicht) return
    const { updatedKlant, updatedProj, updatedMons } = syncOverzichtNaarDb()
    setDownloading(true)

    const updatedSelKlant = updatedKlant || selKlant
    const updatedSelProj = updatedProj || selProj
    const updatedSelMons = updatedMons || selMons
    const updatedForm = {
      start: overzicht.startdatum || form.start,
      signdate: overzicht.signdate || form.signdate,
      omschr: overzicht.omschr || form.omschr,
    }
    const updatedTarieven = overzicht.tarieven || tarieven

    // Haal de tekenbevoegde uit het overzicht (niet uit selProj.tb_id die mogelijk stale is)
    const tbNaam = overzicht.tekenbevoegde?.naam || ''

    const result = await validateOvereenkomst({ ent, selKlant: updatedSelKlant, selProj: updatedSelProj, selMons: updatedSelMons })
    if (!result.compleet && result.ontbrekend.length > 0) {
      setDownloading(false)
      setOntbrekendModal(result.ontbrekend)
      setOntbrekendInputs({})
      return
    }

    // Bouw payload direct hier om de stale tb_id lookup te omzeilen
    await downloadOvereenkomstenMet({ ent, selKlant: updatedSelKlant, selProj: updatedSelProj, selMons: updatedSelMons, form: updatedForm, tarieven: updatedTarieven, tbNaam, toast, db })
    setDownloading(false)
  }

  async function saveOntbrekendAanvullingen() {
    let newDb = { ...db }
    let updatedKlant = selKlant
    let updatedProj = selProj
    const updatedMons = [...selMons]
    ontbrekendModal.forEach(item => {
      const waarde = (ontbrekendInputs[item.veld + '_' + (item.monteur_id || '')] || '').trim()
      if (!waarde) return
      if (item.veld === 'tekenbevoegde') {
        const nieuweTb = { id: uid(), naam: waarde, functie: 'Tekenbevoegde' }
        const klanten = newDb.klanten.map(k => {
          if (k.id !== selKlant.id) return k
          const tekenbevoegden = [...k.tekenbevoegden, nieuweTb]
          const projecten = k.projecten.map(p => p.id === selProj.id ? { ...p, tb_id: nieuweTb.id } : p)
          return { ...k, tekenbevoegden, projecten }
        })
        newDb = { ...newDb, klanten }
        updatedKlant = klanten.find(k => k.id === selKlant.id)
        updatedProj = updatedKlant.projecten.find(p => p.id === selProj.id)
      } else if (item.veld.startsWith('klant.')) {
        const field = item.veld.split('.')[1]
        const klanten = newDb.klanten.map(k => k.id === selKlant.id ? { ...k, [field]: waarde } : k)
        newDb = { ...newDb, klanten }; updatedKlant = klanten.find(k => k.id === selKlant.id)
      } else if (item.veld.startsWith('project.')) {
        const field = item.veld.split('.')[1]
        const klanten = newDb.klanten.map(k => { if (k.id !== selKlant.id) return k; const projecten = k.projecten.map(p => p.id === selProj.id ? { ...p, [field]: waarde } : p); return { ...k, projecten } })
        newDb = { ...newDb, klanten }; updatedKlant = klanten.find(k => k.id === selKlant.id); updatedProj = updatedKlant.projecten.find(p => p.id === selProj.id)
      } else if (item.veld === 'opdrachtomschrijving') {
        const klanten = newDb.klanten.map(k => { if (k.id !== selKlant.id) return k; const projecten = k.projecten.map(p => p.id === selProj.id ? { ...p, omschr: waarde } : p); return { ...k, projecten } })
        newDb = { ...newDb, klanten }; updatedKlant = klanten.find(k => k.id === selKlant.id); updatedProj = updatedKlant.projecten.find(p => p.id === selProj.id)
        setForm(f => ({ ...f, omschr: waarde }))
      } else if (item.veld.startsWith('monteur.')) {
        const field = item.veld.split('.')[1]
        const tf = field === 'persnr' ? (ent === 'west' ? 'persnr_west' : 'persnr_nl') : field
        const monteurs = newDb.monteurs.map(m => m.id === item.monteur_id ? { ...m, [tf]: waarde } : m)
        newDb = { ...newDb, monteurs }
        const idx = updatedMons.findIndex(m => m.id === item.monteur_id)
        if (idx >= 0) updatedMons[idx] = monteurs.find(m => m.id === item.monteur_id)
      }
    })
    save(newDb); setSelKlant(updatedKlant); setSelProj(updatedProj); setSelMons(updatedMons)
    setOntbrekendModal(null)
    toast('Aanvullingen opgeslagen — overeenkomsten worden gegenereerd...')
    setDownloading(true)
    await downloadOvereenkomsten({ ent, selKlant: updatedKlant, selProj: updatedProj, selMons: updatedMons, form, tarieven, toast })
    setDownloading(false)
  }

  const filteredKlanten = db.klanten.filter(k => k.naam.toLowerCase().includes(zoekKlant.toLowerCase()))
  const filteredMons = db.monteurs.filter(m => m.naam.toLowerCase().includes(zoekMon.toLowerCase()) || (m.handelsnaam || '').toLowerCase().includes(zoekMon.toLowerCase()))

  function NavRow({ back, next, nextDisabled, nextLabel }) {
    return (
      <div className="nav-row">
        {back ? <button className="btn btn-sm" onClick={() => goStep(back)}>← Terug</button> : <span />}
        {next && <button className="btn btn-primary btn-sm" onClick={() => goStep(next)} disabled={nextDisabled}>{nextLabel || 'Volgende'} →</button>}
      </div>
    )
  }

  // ── Bewerkbaar veld component ─────────────────────────────────────────────
  function EditField({ label, value, onChange, multiline, placeholder }) {
    return (
      <div className="ov-field">
        <div className="ov-label">{label}</div>
        {multiline
          ? <textarea className="finput ov-input" rows={2} value={value || ''} onChange={ev => onChange(ev.target.value)} placeholder={placeholder || label} />
          : <input className="finput ov-input" value={value || ''} onChange={ev => onChange(ev.target.value)} placeholder={placeholder || label} />
        }
      </div>
    )
  }

  return (
    <div>
      <div ref={topRef} />

      {/* STEP BAR */}
      <div className="step-bar">
        {['Entiteit','Klant & project','Monteurs','Tarieven & datum','Overzicht & download'].map((lbl, i) => (
          <div key={i} className={`step ${step > i+1 ? 'done clickable' : step === i+1 ? 'active' : ''}`}
               onClick={() => { if (step > i+1) goStep(i+1) }}>
            <div className="step-num">{step > i+1 ? '✓' : i+1}</div>
            <div className="step-lbl">{lbl}</div>
            {i < 4 && <div className="step-line" />}
          </div>
        ))}
      </div>

      {/* STAP 1 */}
      {step === 1 && (
        <div className="card">
          <div className="card-hdr">Kies entiteit</div>
          <NavRow next={2} />
          <div className="ent-toggle" style={{ margin: '12px 0' }}>
            <button className={`ent-btn ${ent === 'nl' ? 'act-nl' : ''}`} onClick={() => setEnt('nl')}>
              <img src="/logo-nederland.jpg" alt="NL" style={{ height: 32, objectFit: 'contain' }} />GTO Nederland
            </button>
            <button className={`ent-btn ${ent === 'west' ? 'act-west' : ''}`} onClick={() => setEnt('west')}>
              <img src="/logo-west.jpg" alt="West" style={{ height: 32, objectFit: 'contain' }} />GTO West
            </button>
          </div>
          <NavRow next={2} />
        </div>
      )}

      {/* STAP 2 — Klant & project */}
      {step === 2 && (
        <div className="card">
          <div className="card-hdr">Klant & project</div>
          <NavRow back={1} next={3} nextDisabled={!selKlant || !selProj} />
          <div className="form-grid-2" style={{ marginTop: 12 }}>
            <div>
              <div className="flbl" style={{ marginBottom: 6 }}>Klant</div>
              <input className="finput" placeholder="🔍 Zoek klant..." value={zoekKlant}
                onChange={ev => setZoekKlant(ev.target.value)} style={{ marginBottom: 8 }} />
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                {filteredKlanten.map(k => (
                  <div key={k.id} className={`list-item clickable ${selKlant?.id === k.id ? 'selected' : ''}`} onClick={() => pickKlant(k)}>
                    <div className="av av-coral">{av(k.naam)}</div>
                    <div className="pinfo"><div className="pname">{k.naam}</div><div className="psub">{k.contact}</div></div>
                    {k.afw && k.afw.length > 0 && <span className="badge badge-afw">Afw.</span>}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="flbl" style={{ marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Project {!selKlant && <span style={{ color: '#bbb', fontWeight: 400 }}>(selecteer eerst klant)</span>}</span>
                {selKlant && <button className="btn btn-sm" style={{ fontSize: 11 }} onClick={openNieuwProj}>+ Nieuw project</button>}
              </div>
              <div style={{ opacity: selKlant ? 1 : 0.4, pointerEvents: selKlant ? 'auto' : 'none', maxHeight: 320, overflowY: 'auto' }}>
                {selKlant?.projecten.map(p => (
                  <div key={p.id} className={`list-item clickable ${selProj?.id === p.id ? 'selected' : ''}`} onClick={() => pickProj(p)}>
                    <div className="proj-icon">📁</div>
                    <div className="pinfo"><div className="pname">{p.naam}</div><div className="psub">Nr: {p.nr} · {p.werkadres}</div></div>
                  </div>
                ))}
                {selKlant && !selKlant.projecten.length && <div className="empty">Geen projecten</div>}
              </div>
            </div>
          </div>
          {selKlant?.afw && selKlant.afw.length > 0 && (
            <div className="afw-box" style={{ marginTop: 10 }}>
              <div className="afw-title">⚠ Klantspecifieke afwijkingen actief</div>
              {selKlant.afw.map((a, i) => <div key={i} className="afw-item">{a}</div>)}
            </div>
          )}
          <NavRow back={1} next={3} nextDisabled={!selKlant || !selProj} />
        </div>
      )}

      {/* STAP 3 — Monteurs */}
      {step === 3 && (
        <div className="card">
          <div className="card-hdr">Selecteer monteurs <span style={{ fontSize: 11, fontWeight: 400, color: '#999' }}>— meerdere mogelijk</span></div>
          <NavRow back={2} next={4} nextDisabled={!selMons.length} />
          <div className="tag-list" style={{ margin: '8px 0' }}>
            {selMons.map(m => <span key={m.id} className="tag">{m.naam} <span className="tag-x" onClick={() => toggleMon(m)}>×</span></span>)}
          </div>
          <input className="finput" placeholder="🔍 Zoek monteur of bedrijf..." value={zoekMon}
            onChange={ev => setZoekMon(ev.target.value)} style={{ marginBottom: 8 }} />
          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {filteredMons.map(m => {
              const isSel = selMons.find(x => x.id === m.id)
              const persnr = getPersnr(m, ent)
              return (
                <div key={m.id} className={`list-item clickable ${isSel ? 'selected' : ''}`} onClick={() => toggleMon(m)}>
                  <div className={`chk ${isSel ? 'on' : ''}`} />
                  <div className="av av-blue">{av(m.naam)}</div>
                  <div className="pinfo">
                    <div className="pname">{m.naam}</div>
                    <div className="psub">{m.handelsnaam} · {persnr ? `#${persnr}` : <span style={{ color: '#e8651a' }}>nr ontbreekt voor {e.naam}</span>}</div>
                  </div>
                  {persnr ? <span className={`badge ${isWestPersnr(persnr) ? 'badge-west' : 'badge-nl'}`}>#{persnr}</span> : <span className="badge badge-afw">Nr ontbreekt</span>}
                </div>
              )
            })}
          </div>
          <NavRow back={2} next={4} nextDisabled={!selMons.length} />
        </div>
      )}

      {/* STAP 4 — Tarieven & datum */}
      {step === 4 && (
        <div className="card">
          <div className="card-hdr">Tarieven & datum</div>
          <NavRow back={3} />
          <div className="summ" style={{ margin: '10px 0' }}>
            <strong>{e.naam}</strong> · {selKlant?.naam} · {selProj?.naam} ({selProj?.nr})
          </div>
          {selMons.map(m => {
            const persnr = getPersnr(m, ent)
            return (
              <div key={m.id} style={{ background: '#f8f8f8', borderRadius: 6, padding: '10px 12px', marginBottom: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {m.naam} {persnr ? <span className={`badge ${isWestPersnr(persnr) ? 'badge-west' : 'badge-nl'}`}>#{persnr}</span> : <span className="badge badge-afw">Nr ontbreekt</span>}
                </div>
                {/* Persoonsnummer inline invoeren als het ontbreekt */}
                {!persnr && (
                  <div className="fg" style={{ marginBottom: 8 }}>
                    <label className="flbl" style={{ color: '#e8651a' }}>Persoonsnummer voor {e.naam} — wordt opgeslagen in profiel</label>
                    <input className="finput" placeholder={ent === 'west' ? 'bijv. W134' : 'bijv. 284'}
                      onBlur={ev => { if (ev.target.value.trim()) savePersnrInOverzicht(m.id, ev.target.value.trim()) }}
                      onKeyDown={ev => { if (ev.key === 'Enter' && ev.target.value.trim()) savePersnrInOverzicht(m.id, ev.target.value.trim()) }} />
                  </div>
                )}
                <div className="form-grid-3">
                  <div className="fg">
                    <label className="flbl">Uurtarief monteur (€)</label>
                    <input className="finput" type="number" step="0.01" placeholder="45.00" value={tarieven[`${m.id}_zzp`] || ''}
                      onChange={ev => setTarief(m.id, 'zzp', ev.target.value)} />
                  </div>
                  <div className="fg">
                    <label className="flbl">Uurtarief klant (€)</label>
                    <input className="finput" type="number" step="0.01" placeholder="54.00" value={tarieven[`${m.id}_kl`] || ''}
                      onChange={ev => setTarief(m.id, 'kl', ev.target.value)} />
                  </div>
                  <div className="fg">
                    <label className="flbl">Reisuur (vrij tekst, bijv. "1 reisuur 1:1")</label>
                    <input className="finput" type="text" placeholder="1 reisuur 1:1" value={tarieven[`${m.id}_reis`] || ''}
                      onChange={ev => setTarief(m.id, 'reis', ev.target.value)} />
                  </div>
                </div>
              </div>
            )
          })}
          <div className="form-grid-2" style={{ marginTop: 10 }}>
            <div className="fg"><label className="flbl">Startdatum</label><input className="finput" type="date" value={form.start} onChange={ev => setForm(f => ({ ...f, start: ev.target.value }))} /></div>
            <div className="fg"><label className="flbl">Datum handtekening</label><input className="finput" type="date" value={form.signdate} onChange={ev => setForm(f => ({ ...f, signdate: ev.target.value }))} /></div>
          </div>
          <div className="fg" style={{ marginTop: 8 }}>
            <label className="flbl">Opdrachtomschrijving</label>
            <textarea className="finput" rows={3} style={{ resize: 'vertical' }} value={form.omschr} onChange={ev => setForm(f => ({ ...f, omschr: ev.target.value }))} />
          </div>
          <div className="nav-row" style={{ marginTop: 12 }}>
            <button className="btn btn-sm" onClick={() => goStep(3)}>← Terug</button>
            <button className="btn btn-primary btn-sm" onClick={buildOverzicht}>Naar overzicht →</button>
          </div>
        </div>
      )}

      {/* STAP 5 — Bewerkbaar overzicht */}
      {step === 5 && overzicht && (
        <div>
          <div className="card">
            <div className="card-hdr">Controleer & bewerk — alles wordt automatisch opgeslagen</div>
            <p style={{ fontSize: 12, color: '#888', marginBottom: 14 }}>
              Pas hier gegevens aan vóór het genereren. Wijzigingen worden direct opgeslagen in het profiel van de betreffende monteur, klant of project — de volgende keer staan ze er al goed in.
            </p>

            {/* Entiteit & data */}
            <div className="ov-sectie">📋 Overeenkomst</div>
            <div className="form-grid-2">
              <div className="ov-field"><div className="ov-label">Entiteit</div><div className="ov-static">{e.naam}</div></div>
              <div className="ov-field"><div className="ov-label">Startdatum</div>
                <input className="finput ov-input" type="date" value={overzicht.startdatum || ''} onChange={ev => updateOv('startdatum', ev.target.value)} />
              </div>
              <div className="ov-field"><div className="ov-label">Datum handtekening</div>
                <input className="finput ov-input" type="date" value={overzicht.signdate || ''} onChange={ev => updateOv('signdate', ev.target.value)} />
              </div>
              <div className="ov-field full-width">
                <EditField label="Opdrachtomschrijving" value={overzicht.omschr} onChange={v => updateOv('omschr', v)} multiline />
              </div>
            </div>

            {/* Klant */}
            <div className="ov-sectie">🏢 Klant</div>
            <div className="form-grid-2">
              <EditField label="Bedrijfsnaam" value={overzicht.klant.naam} onChange={v => updateOv('klant.naam', v)} />
              <EditField label="Adres" value={overzicht.klant.adres} onChange={v => updateOv('klant.adres', v)} />
              <EditField label="KvK-nummer" value={overzicht.klant.kvk} onChange={v => updateOv('klant.kvk', v)} />
              <EditField label="BTW-nummer" value={overzicht.klant.btw} onChange={v => updateOv('klant.btw', v)} />
              <EditField label="Contactpersoon" value={overzicht.klant.contact} onChange={v => updateOv('klant.contact', v)} />
              <EditField label="Factuur e-mail" value={overzicht.klant.fmail} onChange={v => updateOv('klant.fmail', v)} />
            </div>

            {/* Tekenbevoegde */}
            <div className="ov-sectie">✍ Tekenbevoegde</div>
            <div style={{ position: 'relative' }}>
              <div className="ov-field">
                <div className="ov-label">Tekenbevoegde voor dit project</div>
                <div className="tb-selector" onClick={() => { setTbDropdownOpen(o => !o); setNieuwTbMode(false) }}>
                  <span>{overzicht.tekenbevoegde ? overzicht.tekenbevoegde.naam : <span style={{ color: '#bbb' }}>— Selecteer tekenbevoegde —</span>}</span>
                  <span style={{ color: '#bbb' }}>▼</span>
                </div>
              </div>
              {tbDropdownOpen && (
                <div className="tb-dropdown">
                  {selKlant.tekenbevoegden.map(tb => (
                    <div key={tb.id} className="tb-option" onClick={() => kiesTekenbevoegde(tb)}>
                      {tb.naam} <span style={{ fontSize: 10, color: '#bbb' }}>{tb.functie}</span>
                    </div>
                  ))}
                  <div className="tb-option" style={{ color: '#e8651a', borderTop: '1px solid #eee' }} onClick={() => setNieuwTbMode(true)}>
                    + Nieuwe tekenbevoegde toevoegen
                  </div>
                  {nieuwTbMode && (
                    <div style={{ padding: '8px 10px', borderTop: '1px solid #eee' }}>
                      <input className="finput" autoFocus placeholder="Naam tekenbevoegde" value={nieuwTbInput}
                        onChange={ev => setNieuwTbInput(ev.target.value)}
                        onKeyDown={ev => ev.key === 'Enter' && voegNieuweTbToe()} style={{ marginBottom: 6 }} />
                      <button className="btn btn-primary btn-sm" onClick={voegNieuweTbToe} disabled={!nieuwTbInput.trim()}>Toevoegen & koppelen</button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Project */}
            <div className="ov-sectie">📁 Project</div>
            <div className="form-grid-2">
              <EditField label="Projectnummer" value={overzicht.project.nr} onChange={v => updateOv('project.nr', v)} />
              <EditField label="Projectnaam" value={overzicht.project.naam} onChange={v => updateOv('project.naam', v)} />
              <EditField label="Werkadres" value={overzicht.project.werkadres} onChange={v => updateOv('project.werkadres', v)} />
            </div>

            {/* Monteurs */}
            {overzicht.monteurs.map((m, mi) => (
              <div key={m.id}>
                <div className="ov-sectie">👷 Monteur {overzicht.monteurs.length > 1 ? mi + 1 : ''}: {m.naam}</div>
                <div className="form-grid-2">
                  <EditField label="Naam" value={m.naam} onChange={v => updateOv(`monteur.${m.id}.naam`, v)} />
                  <EditField label="Handelsnaam" value={m.handelsnaam} onChange={v => updateOv(`monteur.${m.id}.handelsnaam`, v)} />
                  <EditField label="KvK-nummer" value={m.kvk} onChange={v => updateOv(`monteur.${m.id}.kvk`, v)} />
                  <EditField label="Adres" value={m.adres} onChange={v => updateOv(`monteur.${m.id}.adres`, v)} />
                  <div className="ov-field">
                    <div className="ov-label">Persoonsnummer ({e.naam})</div>
                    <input className="finput ov-input" value={getPersnr(m, ent) || ''}
                      onChange={ev => {
                        updateOv(`monteur.${m.id}.persnr`, ev.target.value)
                        savePersnrInOverzicht(m.id, ev.target.value)
                      }}
                      placeholder={ent === 'west' ? 'bijv. W134' : 'bijv. 284'} />
                  </div>
                  <div className="ov-field">
                    <div className="ov-label">Uurtarief monteur (€)</div>
                    <input className="finput ov-input" type="number" step="0.01" value={overzicht.tarieven[`${m.id}_zzp`] || ''}
                      onChange={ev => setOverzicht(ov => ({ ...ov, tarieven: { ...ov.tarieven, [`${m.id}_zzp`]: ev.target.value } }))} />
                  </div>
                  <div className="ov-field">
                    <div className="ov-label">Uurtarief klant (€)</div>
                    <input className="finput ov-input" type="number" step="0.01" value={overzicht.tarieven[`${m.id}_kl`] || ''}
                      onChange={ev => setOverzicht(ov => ({ ...ov, tarieven: { ...ov.tarieven, [`${m.id}_kl`]: ev.target.value } }))} />
                  </div>
                  <div className="ov-field">
                    <div className="ov-label">Reisuur (bijv. "1 reisuur 1:1")</div>
                    <input className="finput ov-input" type="text" placeholder="1 reisuur 1:1" value={overzicht.tarieven[`${m.id}_reis`] || ''}
                      onChange={ev => setOverzicht(ov => ({ ...ov, tarieven: { ...ov.tarieven, [`${m.id}_reis`]: ev.target.value } }))} />
                  </div>
                </div>
              </div>
            ))}

            <div className="nav-row" style={{ marginTop: 16 }}>
              <button className="btn btn-sm" onClick={() => goStep(4)}>← Terug</button>
              <button className="btn btn-primary btn-sm" disabled={downloading} onClick={handleDownload}>
                {downloading ? '⏳ Bezig met genereren...' : '⬇ Alles klopt — download overeenkomsten (ZIP)'}
              </button>
            </div>
          </div>

          {/* Ontbrekend modal */}
          {ontbrekendModal && (
            <div className="modal-bg">
              <div className="modal">
                <div className="modal-title">⚠ Nog niet alle gegevens ingevuld</div>
                <p style={{ fontSize: 13, color: '#555', marginBottom: 14 }}>Vul de ontbrekende gegevens in — worden direct opgeslagen.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 360, overflowY: 'auto' }}>
                  {ontbrekendModal.map((item, i) => {
                    const key = item.veld + '_' + (item.monteur_id || '')
                    return (
                      <div key={i} className="fg">
                        <label className="flbl">{item.label} {item.context && <span style={{ fontWeight: 400, color: '#999' }}>— {item.context}</span>}</label>
                        <input className="finput" value={ontbrekendInputs[key] || ''} onChange={ev => setOntbrekendInputs(p => ({ ...p, [key]: ev.target.value }))} autoFocus={i === 0} />
                      </div>
                    )
                  })}
                </div>
                <div className="modal-footer">
                  <button className="btn btn-sm" onClick={() => setOntbrekendModal(null)}>Annuleren</button>
                  <button className="btn btn-primary btn-sm" onClick={saveOntbrekendAanvullingen}>Opslaan & downloaden</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {nieuwProjModal && selKlant && (
        <div className="modal-bg" onClick={ev => ev.target.className === 'modal-bg' && setNieuwProjModal(false)}>
          <div className="modal">
            <div className="modal-title">Nieuw project toevoegen aan {selKlant.naam}</div>
            <div className="form-grid-2">
              <div className="fg"><label className="flbl">Projectnummer (van klant)</label><input className="finput" value={nieuwProjForm.nr} onChange={ev => setNieuwProjForm(p => ({ ...p, nr: ev.target.value }))} autoFocus /></div>
              <div className="fg"><label className="flbl">Projectnaam</label><input className="finput" value={nieuwProjForm.naam} onChange={ev => setNieuwProjForm(p => ({ ...p, naam: ev.target.value }))} /></div>
              <div className="fg full"><label className="flbl">Werkadres</label><input className="finput" value={nieuwProjForm.werkadres} onChange={ev => setNieuwProjForm(p => ({ ...p, werkadres: ev.target.value }))} /></div>
              <div className="fg full"><label className="flbl">Opdrachtomschrijving</label><textarea className="finput" rows={2} value={nieuwProjForm.omschr} onChange={ev => setNieuwProjForm(p => ({ ...p, omschr: ev.target.value }))} /></div>
              {selKlant.tekenbevoegden.length > 0 && (
                <div className="fg full">
                  <label className="flbl">Tekenbevoegde</label>
                  <select className="finput" value={nieuwProjForm.tb_id} onChange={ev => setNieuwProjForm(p => ({ ...p, tb_id: ev.target.value }))}>
                    <option value="">— Selecteer —</option>
                    {selKlant.tekenbevoegden.map(t => <option key={t.id} value={t.id}>{t.naam}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-sm" onClick={() => setNieuwProjModal(false)}>Annuleren</button>
              <button className="btn btn-primary btn-sm" onClick={saveNieuwProj} disabled={!nieuwProjForm.nr || !nieuwProjForm.naam}>Aanmaken & selecteren</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

  async function handleDownload() {
    setDownloading(true)
    const result = await validateOvereenkomst({ ent, selKlant, selProj, selMons })
    if (!result.compleet && result.ontbrekend.length > 0) {
      setDownloading(false)
      setOntbrekendModal(result.ontbrekend)
      setOntbrekendInputs({})
      return
    }
    await downloadOvereenkomsten({ ent, selKlant, selProj, selMons, form, tarieven, toast })
    setDownloading(false)
  }

  // Sla de door de gebruiker aangevulde ontbrekende velden permanent op in het
  // klant-/project-/monteurprofiel, zodat ze de volgende keer niet meer gevraagd worden.
  async function saveOntbrekendAanvullingen() {
    let newDb = { ...db }
    let updatedKlant = selKlant
    let updatedProj = selProj
    const updatedMons = [...selMons]

    ontbrekendModal.forEach(item => {
      const waarde = (ontbrekendInputs[item.veld + '_' + (item.monteur_id || '')] || '').trim()
      if (!waarde) return

      if (item.veld === 'tekenbevoegde') {
        // Voeg toe als nieuwe tekenbevoegde aan de klant, en koppel aan het huidige project
        const nieuweTb = { id: uid(), naam: waarde, functie: 'Tekenbevoegde' }
        const klanten = newDb.klanten.map(k => {
          if (k.id !== selKlant.id) return k
          const tekenbevoegden = [...k.tekenbevoegden, nieuweTb]
          const projecten = k.projecten.map(p => p.id === selProj.id ? { ...p, tb_id: nieuweTb.id } : p)
          return { ...k, tekenbevoegden, projecten }
        })
        newDb = { ...newDb, klanten }
        updatedKlant = klanten.find(k => k.id === selKlant.id)
        updatedProj = updatedKlant.projecten.find(p => p.id === selProj.id)
      } else if (item.veld.startsWith('klant.')) {
        const field = item.veld.split('.')[1]
        const klanten = newDb.klanten.map(k => k.id === selKlant.id ? { ...k, [field]: waarde } : k)
        newDb = { ...newDb, klanten }
        updatedKlant = klanten.find(k => k.id === selKlant.id)
      } else if (item.veld.startsWith('project.')) {
        const field = item.veld.split('.')[1]
        const klanten = newDb.klanten.map(k => {
          if (k.id !== selKlant.id) return k
          const projecten = k.projecten.map(p => p.id === selProj.id ? { ...p, [field]: waarde } : p)
          return { ...k, projecten }
        })
        newDb = { ...newDb, klanten }
        updatedKlant = klanten.find(k => k.id === selKlant.id)
        updatedProj = updatedKlant.projecten.find(p => p.id === selProj.id)
      } else if (item.veld === 'opdrachtomschrijving') {
        const klanten = newDb.klanten.map(k => {
          if (k.id !== selKlant.id) return k
          const projecten = k.projecten.map(p => p.id === selProj.id ? { ...p, omschr: waarde } : p)
          return { ...k, projecten }
        })
        newDb = { ...newDb, klanten }
        updatedKlant = klanten.find(k => k.id === selKlant.id)
        updatedProj = updatedKlant.projecten.find(p => p.id === selProj.id)
        setForm(f => ({ ...f, omschr: waarde }))
      } else if (item.veld.startsWith('monteur.')) {
        const field = item.veld.split('.')[1]
        const targetField = field === 'persnr' ? (ent === 'west' ? 'persnr_west' : 'persnr_nl') : field
        const monteurs = newDb.monteurs.map(m => m.id === item.monteur_id ? { ...m, [targetField]: waarde } : m)
        newDb = { ...newDb, monteurs }
        const idx = updatedMons.findIndex(m => m.id === item.monteur_id)
        if (idx >= 0) updatedMons[idx] = monteurs.find(m => m.id === item.monteur_id)
      }
    })

    save(newDb)
    setSelKlant(updatedKlant)
    setSelProj(updatedProj)
    setSelMons(updatedMons)
    setOntbrekendModal(null)
    toast('Aanvullingen opgeslagen — overeenkomsten worden gegenereerd...')

    // Probeer de download direct opnieuw met de aangevulde gegevens
    setDownloading(true)
    await downloadOvereenkomsten({ ent, selKlant: updatedKlant, selProj: updatedProj, selMons: updatedMons, form, tarieven, toast })
    setDownloading(false)
  }

  function scrollTop() { topRef.current?.scrollIntoView({ behavior: 'smooth' }) }

  function goStep(n) { setStep(n); scrollTop() }

  function pickKlant(k) { setSelKlant(k); setSelProj(null) }
  function pickProj(p) { setSelProj(p); setForm(f => ({ ...f, omschr: p.omschr })) }



// ── PO PREVIEW ────────────────────────────────────────────────────────────
function POPreview({ type, ent, mon, klant, proj, form, tarieven, settings, entKey }) {
  const persnr = getPersnr(mon, entKey)
  const combo = `${proj.nr} + ${persnr}`
  const start = fmtDate(form.start)
  const signdate = fmtDate(form.signdate)
  const omschr = form.omschr || proj.omschr
  const tzzp = fmtEuro(tarieven[`${mon.id}_zzp`])
  const tkl = fmtEuro(tarieven[`${mon.id}_kl`])
  const reis = tarieven[`${mon.id}_reis`] ? ` + reisuur: ${fmtEuro(tarieven[`${mon.id}_reis`])}` : ''
  const tb = klant.tekenbevoegden.find(t => t.id === proj.tb_id) || klant.tekenbevoegden[0] || { naam: '[tekenbevoegde]' }

  const rows_zzp = [
    ['KLANT', klant.naam], ['PROJECTNAAM', proj.naam], ['PROJECT ADRES', proj.werkadres],
    ['PROJECTNUMMER', proj.nr], ['PERSOONSNUMMER', persnr], ['BETALINGSTERMIJN', (klant.betaling || '2 weken').toUpperCase()],
    ['—', ''], ['NAAM OPDRACHTNEMER', mon.naam], ['HANDELSNAAM OPDRACHTNEMER', mon.handelsnaam],
    ['KVK-NUMMER OPDRACHTNEMER', mon.kvk], ['OPDRACHTOMSCHRIJVING', omschr],
    ['STARTDATUM', start], ['EINDDATUM', settings.einddatum_default],
    ['UURTARIEF (BTW verlegd)', tzzp + reis],
    ['OPZEGTERMIJN', `Voor beide partijen geldt een schriftelijke opzegtermijn van ${klant.opzeg || '5 werkdagen'}.`]
  ]
  const rows_klant = [
    ['KLANT/OPDRACHTGEVER', klant.naam], ['ADRES', klant.adres], ['KVK-NUMMER', klant.kvk],
    ['BTW-NUMMER', klant.btw], ['CONTACTPERSOON', klant.contact], ['TEKENBEVOEGDE', tb.naam],
    ['WERKADRES', proj.werkadres], ['FACTUUR EMAILADRES OPDRACHTGEVER', klant.fmail],
    ['BETALINGSTERMIJN', klant.betaling || '2 weken'], ['—', ''],
    ['NAAM ZELFSTANDIGE', mon.naam], ['HANDELSNAAM ZELFSTANDIGE', mon.handelsnaam],
    ['KVK-NUMMER ZELFSTANDIGE', mon.kvk], ['OPDRACHTOMSCHRIJVING', omschr],
    ['PROJECTNUMMER', proj.nr], ['PERSOONSNUMMER', persnr],
    ['STARTDATUM', start], ['EINDDATUM', settings.einddatum_default],
    ['UURTARIEF (BTW verlegd)', tkl + reis],
    ['OPZEGTERMIJN', `Voor beide partijen geldt een schriftelijke opzegtermijn van ${klant.opzeg || '5 werkdagen'}.`]
  ]

  const rows = type === 'zzp' ? rows_zzp : rows_klant
  const title = type === 'zzp' ? 'Projectovereenkomst ZZP' : 'Projectovereenkomst Klant'

  return (
    <div className="po-wrap">
      <div className="po-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src={ent.logo} alt={ent.naam} style={{ height: 48, objectFit: 'contain' }} />
          <div>
            <div style={{ fontSize: 9, color: '#888', maxWidth: 220, lineHeight: 1.4 }}>{ent.naam} maakt gebruik van de algemene modelovereenkomst tussenkomst {ent.model_ref}</div>
            <div style={{ fontSize: 8, color: '#bbb' }}>Versie: {settings.versie}</div>
          </div>
        </div>
        <div className="po-ent-right">
          <strong>{ent.naam}</strong><br />{ent.adres}<br />KvK nr.: {ent.kvknr}<br />BTW nr.: {ent.btwnr}<br />{ent.email}<br />{ent.web}
        </div>
      </div>
      <div className="po-title">{title}</div>
      <div className="po-nr"><strong>Projectnummer + persoonsnummer:</strong> {combo}</div>
      <div className="po-parties">
        <strong>De ondergetekenden:</strong><br /><br />
        {type === 'zzp' ? <>
          <strong>I.</strong>&nbsp; {ent.bedrijfsnaam_zzp}, gevestigd aan de {ent.adres}, ten deze rechtsgeldig vertegenwoordigd door de heer {ent.signer_zzp},<br />
          <em>Hierna te noemen: 'Opdrachtgever';</em><br /><br />
          <strong>II.</strong>&nbsp; <strong>Bedrijfsnaam:</strong> {mon.handelsnaam}<br />
          <strong>Adres:</strong> {mon.adres}<br />
          ten deze rechtsgeldig vertegenwoordigd door naam: {mon.naam}<br />
          <em>Hierna te noemen: 'Opdrachtnemer';</em>
        </> : <>
          <strong>I.</strong>&nbsp; {klant.naam}, gevestigd aan de {klant.adres}, te dezen rechtsgeldig vertegenwoordigd door {tb.naam};<br />
          <em>Hierna te noemen: 'Opdrachtgever';</em><br /><br />
          <strong>II.</strong>&nbsp; {ent.bedrijfsnaam_klant}, gevestigd aan de {ent.adres}, te dezen rechtsgeldig vertegenwoordigd door de heer {ent.signer_klant};<br />
          <em>Hierna te noemen: 'Opdrachtnemer';</em>
        </>}
      </div>
      <div className="po-agreed">Verklaren te zijn overeengekomen als volgt:</div>
      <table className="po-tbl">
        <tbody>
          {rows.map(([k, v], i) => k === '—'
            ? <tr key={i}><td colSpan={2} style={{ height: 4, border: 'none', background: 'white' }} /></tr>
            : <tr key={i}><td className="po-lbl">{k}</td><td>{v}</td></tr>
          )}
        </tbody>
      </table>
      {klant.afw && klant.afw.length > 0 && (
        <div className="afw-box" style={{ margin: '8px 0' }}>
          <div className="afw-title">⚠ Klantspecifieke afwijkingen toegepast</div>
          {klant.afw.map((a, i) => <div key={i} className="afw-item">{a}</div>)}
        </div>
      )}
      {type === 'zzp' ? (
        <div className="zzp-sign">
          <div><div style={{ fontWeight: 700, marginBottom: 14 }}>HANDTEKENING {ent.naam}</div><div className="zzp-dots">………………………………………</div></div>
          <div><div style={{ fontWeight: 700, marginBottom: 14 }}>HANDTEKENING OPDRACHTNEMER</div><div className="zzz-dots">………………………………………</div></div>
        </div>
      ) : (
        <table className="sign-tbl">
          <tbody>
            <tr><td className="slbl">Akkoord gegaan door Opdrachtgever:</td><td>{tb.naam}</td></tr>
            <tr><td className="slbl">Handtekening:</td><td className="sspace" /></tr>
            <tr><td className="slbl">Akkoord gegaan door Opdrachtnemer</td><td>{ent.naam}<br />{ent.signer_klant}</td></tr>
            <tr><td className="slbl">Datum akkoord gegaan:</td><td>{signdate}</td></tr>
            <tr><td className="slbl">Handtekening</td><td className="sspace" /></tr>
          </tbody>
        </table>
      )}
      <div className="po-foot">Copyright © (alle rechten voorbehouden)</div>
    </div>
  )
}

// ── MONTEURS BEHEER ───────────────────────────────────────────────────────
function MonteursScreen({ db, save, toast }) {
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({})
  const [zoek, setZoek] = useState('')

  function openNieuw() { setForm({ naam: '', handelsnaam: '', kvk: '', adres: '', persnr: '', persnr_nl: '', persnr_west: '' }); setModal('nieuw') }
  function openEdit(m) { setForm({ persnr_nl: '', persnr_west: '', ...m }); setModal('edit') }
  function del(id) { if (!confirm('Monteur verwijderen?')) return; save({ ...db, monteurs: db.monteurs.filter(m => m.id !== id) }); toast('Verwijderd') }

  function saveForm() {
    // Zorg dat persnr gevuld is (backwards compat)
    const f = { ...form }
    if (!f.persnr) f.persnr = f.persnr_nl || f.persnr_west || ''
    if (modal === 'nieuw') {
      save({ ...db, monteurs: [...db.monteurs, { ...f, id: uid() }] })
      toast('Monteur toegevoegd')
    } else {
      save({ ...db, monteurs: db.monteurs.map(m => m.id === f.id ? f : m) })
      toast('Monteur bijgewerkt')
    }
    setModal(null)
  }

  const filtered = db.monteurs.filter(m =>
    m.naam.toLowerCase().includes(zoek.toLowerCase()) ||
    (m.handelsnaam || '').toLowerCase().includes(zoek.toLowerCase())
  )

  return (
    <div>
      <div className="card">
        <div className="card-hdr">
          <span>Monteurs ({db.monteurs.length})</span>
          <button className="btn btn-primary btn-sm" onClick={openNieuw}>+ Toevoegen</button>
        </div>
        <input className="finput" placeholder="🔍 Zoek monteur of bedrijfsnaam..." value={zoek}
          onChange={e => setZoek(e.target.value)} style={{ marginBottom: 10 }} />
        {filtered.map(m => {
          const nlNr = m.persnr_nl || (!m.persnr?.startsWith('W') ? m.persnr : '')
          const westNr = m.persnr_west || (m.persnr?.startsWith('W') ? m.persnr : '')
          return (
            <div key={m.id} className="list-item">
              <div className="av av-blue">{av(m.naam)}</div>
              <div className="pinfo">
                <div className="pname">{m.naam}</div>
                <div className="psub">
                  {m.handelsnaam} · KvK: {m.kvk}
                  {nlNr && <span className="badge badge-nl" style={{ marginLeft: 6 }}>NL #{nlNr}</span>}
                  {westNr && <span className="badge badge-west" style={{ marginLeft: 4 }}>West #{westNr}</span>}
                </div>
              </div>
              <button className="btn btn-sm" onClick={() => openEdit(m)}>Bewerken</button>
              <button className="btn btn-sm btn-danger" onClick={() => del(m.id)}>×</button>
            </div>
          )
        })}
      </div>

      {modal && (
        <div className="modal-bg" onClick={e => e.target.className === 'modal-bg' && setModal(null)}>
          <div className="modal">
            <div className="modal-title">{modal === 'nieuw' ? 'Monteur toevoegen' : 'Monteur bewerken'}</div>
            <div className="form-grid-2">
              {[['naam','Naam opdrachtnemer'],['handelsnaam','Handelsnaam'],['kvk','KvK-nummer'],['adres','Adres']].map(([f, lbl]) => (
                <div key={f} className={`fg ${f === 'adres' || f === 'naam' ? 'full' : ''}`}>
                  <label className="flbl">{lbl}</label>
                  <input className="finput" value={form[f] || ''} onChange={ev => setForm(p => ({ ...p, [f]: ev.target.value }))} />
                </div>
              ))}
              <div className="fg">
                <label className="flbl">Persoonsnummer GTO Nederland</label>
                <input className="finput" placeholder="bijv. 284" value={form.persnr_nl || ''} onChange={ev => setForm(p => ({ ...p, persnr_nl: ev.target.value }))} />
              </div>
              <div className="fg">
                <label className="flbl">Persoonsnummer GTO West</label>
                <input className="finput" placeholder="bijv. W134" value={form.persnr_west || ''} onChange={ev => setForm(p => ({ ...p, persnr_west: ev.target.value }))} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-sm" onClick={() => setModal(null)}>Annuleren</button>
              <button className="btn btn-primary btn-sm" onClick={saveForm}>Opslaan</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── KLANTEN BEHEER ────────────────────────────────────────────────────────
function KlantenScreen({ db, save, toast }) {
  const [open, setOpen] = useState({})
  const [modal, setModal] = useState(null)
  const [ctx, setCtx] = useState({})
  const [form, setForm] = useState({})
  const [zoek, setZoek] = useState('')

  function toggle(id) { setOpen(p => ({ ...p, [id]: !p[id] })) }

  function openModal(type, klantId, extra) {
    setCtx({ type, klantId, ...extra })
    const k = db.klanten.find(x => x.id === klantId)
    if (type === 'klant-edit') setForm({ ...k })
    else if (type === 'tb-nieuw') setForm({ naam: '', functie: '' })
    else if (type === 'tb-edit') { const tb = k.tekenbevoegden.find(t => t.id === extra.tbId); setForm({ ...tb }) }
    else if (type === 'proj-nieuw') setForm({ nr: '', naam: '', werkadres: '', omschr: '', tb_id: k.tekenbevoegden[0]?.id || '' })
    else if (type === 'proj-edit') { const p = k.projecten.find(x => x.id === extra.projId); setForm({ ...p }) }
    else if (type === 'afw-edit') setForm({ afw: (k.afw || []).join('\n') })
    else if (type === 'klant-nieuw') setForm({ naam: '', adres: '', kvk: '', btw: '', contact: '', fmail: '', betaling: '2 weken', opzeg: '5 werkdagen', tekenbevoegden: [], afw: [], projecten: [] })
    setModal(type)
  }

  function saveModal() {
    let newKlanten = [...db.klanten]
    if (modal === 'klant-nieuw') {
      newKlanten.push({ ...form, id: uid(), tekenbevoegden: [], afw: [], projecten: [] })
    } else if (modal === 'klant-edit') {
      newKlanten = newKlanten.map(x => x.id === ctx.klantId ? { ...x, ...form } : x)
    } else if (modal === 'afw-edit') {
      newKlanten = newKlanten.map(x => x.id === ctx.klantId ? { ...x, afw: form.afw.split('\n').map(s => s.trim()).filter(Boolean) } : x)
    } else if (modal === 'tb-nieuw') {
      newKlanten = newKlanten.map(x => x.id === ctx.klantId ? { ...x, tekenbevoegden: [...x.tekenbevoegden, { ...form, id: uid() }] } : x)
    } else if (modal === 'tb-edit') {
      newKlanten = newKlanten.map(x => x.id === ctx.klantId ? { ...x, tekenbevoegden: x.tekenbevoegden.map(t => t.id === ctx.tbId ? { ...form } : t) } : x)
    } else if (modal === 'proj-nieuw') {
      newKlanten = newKlanten.map(x => x.id === ctx.klantId ? { ...x, projecten: [...x.projecten, { ...form, id: uid(), tb_id: parseInt(form.tb_id) || form.tb_id }] } : x)
    } else if (modal === 'proj-edit') {
      newKlanten = newKlanten.map(x => x.id === ctx.klantId ? { ...x, projecten: x.projecten.map(p => p.id === ctx.projId ? { ...form, tb_id: parseInt(form.tb_id) || form.tb_id } : p) } : x)
    }
    save({ ...db, klanten: newKlanten })
    toast('Opgeslagen')
    setModal(null)
  }

  function delTb(kid, tid) { if (!confirm('Verwijderen?')) return; save({ ...db, klanten: db.klanten.map(k => k.id === kid ? { ...k, tekenbevoegden: k.tekenbevoegden.filter(t => t.id !== tid) } : k) }); toast('Verwijderd') }
  function delProj(kid, pid) { if (!confirm('Verwijderen?')) return; save({ ...db, klanten: db.klanten.map(k => k.id === kid ? { ...k, projecten: k.projecten.filter(p => p.id !== pid) } : k) }); toast('Verwijderd') }

  const curKlant = ctx.klantId ? db.klanten.find(x => x.id === ctx.klantId) : null
  const filtered = db.klanten.filter(k => k.naam.toLowerCase().includes(zoek.toLowerCase()))

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <input className="finput" placeholder="🔍 Zoek klant..." value={zoek}
          onChange={e => setZoek(e.target.value)} style={{ flex: 1 }} />
        <button className="btn btn-primary btn-sm" onClick={() => openModal('klant-nieuw', null)}>+ Klant toevoegen</button>
      </div>

      {filtered.map(k => (
        <div key={k.id} className="klant-card">
          <div className="klant-head" onClick={() => toggle(k.id)}>
            <div className="av av-coral">{av(k.naam)}</div>
            <div className="pinfo">
              <div className="pname">{k.naam}</div>
              <div className="psub">KvK: {k.kvk} · {k.projecten.length} project(en) · {k.tekenbevoegden.length} tekenbevoegde(n)</div>
            </div>
            {k.afw && k.afw.length > 0 && <span className="badge badge-afw">Afwijkingen</span>}
            <span style={{ color: '#bbb', fontSize: 16, marginLeft: 8 }}>{open[k.id] ? '▲' : '▼'}</span>
          </div>

          {open[k.id] && (
            <div className="klant-body">
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                <button className="btn btn-sm" onClick={() => openModal('klant-edit', k.id)}>✏ Bedrijfsgegevens</button>
                <button className="btn btn-sm" onClick={() => openModal('afw-edit', k.id)}>⚠ Afwijkingen ({(k.afw || []).length})</button>
              </div>

              <div className="section-lbl">Tekenbevoegden</div>
              {k.tekenbevoegden.map(tb => (
                <div key={tb.id} className="list-item" style={{ marginBottom: 4 }}>
                  <div className="av av-blue" style={{ width: 28, height: 28, fontSize: 10 }}>{av(tb.naam)}</div>
                  <div className="pinfo"><div style={{ fontSize: 12, fontWeight: 600 }}>{tb.naam}</div><div className="psub">{tb.functie}</div></div>
                  <button className="btn btn-sm" onClick={() => openModal('tb-edit', k.id, { tbId: tb.id })}>Bewerken</button>
                  <button className="btn btn-sm btn-danger" onClick={() => delTb(k.id, tb.id)}>×</button>
                </div>
              ))}
              <button className="add-btn" onClick={() => openModal('tb-nieuw', k.id)}>+ Tekenbevoegde toevoegen</button>

              <div className="section-lbl" style={{ marginTop: 12 }}>Projecten</div>
              {k.projecten.map(p => {
                const tb = k.tekenbevoegden.find(t => t.id === p.tb_id) || { naam: '—' }
                return (
                  <div key={p.id} style={{ background: '#f8f8f8', borderRadius: 6, padding: '8px 10px', marginBottom: 6, border: '1px solid #eee' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ fontSize: 18 }}>📁</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{p.naam} <span style={{ fontWeight: 400, fontSize: 11, color: '#999' }}>Nr: {p.nr}</span></div>
                        <div style={{ fontSize: 11, color: '#888' }}>{p.werkadres}</div>
                        <div style={{ fontSize: 11, color: '#888' }}>{p.omschr}</div>
                        <div style={{ fontSize: 11, color: '#4a7c9e', marginTop: 2 }}>Tekenbevoegde: {tb.naam}</div>
                      </div>
                      <button className="btn btn-sm" onClick={() => openModal('proj-edit', k.id, { projId: p.id })}>Bewerken</button>
                      <button className="btn btn-sm btn-danger" onClick={() => delProj(k.id, p.id)}>×</button>
                    </div>
                  </div>
                )
              })}
              {/* PROJECT TOEVOEGEN — direct zichtbaar onderaan projecten */}
              <button className="add-btn" onClick={() => openModal('proj-nieuw', k.id)}>+ Project toevoegen</button>
            </div>
          )}
        </div>
      ))}

      {modal && (
        <div className="modal-bg" onClick={e => e.target.className === 'modal-bg' && setModal(null)}>
          <div className="modal">
            <div className="modal-title">{{ 'klant-nieuw':'Klant toevoegen','klant-edit':'Bedrijfsgegevens bewerken','afw-edit':'Afwijkingen','tb-nieuw':'Tekenbevoegde toevoegen','tb-edit':'Tekenbevoegde bewerken','proj-nieuw':'Project toevoegen','proj-edit':'Project bewerken' }[modal]}</div>

            {(modal === 'klant-nieuw' || modal === 'klant-edit') && (
              <div className="form-grid-2">
                {[['naam','Bedrijfsnaam'],['adres','Adres'],['kvk','KvK-nummer'],['btw','BTW-nummer'],['contact','Contactpersoon'],['fmail','Factuur e-mail'],['betaling','Betalingstermijn'],['opzeg','Opzegtermijn']].map(([f, lbl]) => (
                  <div key={f} className={`fg ${f === 'naam' || f === 'adres' ? 'full' : ''}`}>
                    <label className="flbl">{lbl}</label>
                    <input className="finput" value={form[f] || ''} onChange={ev => setForm(p => ({ ...p, [f]: ev.target.value }))} />
                  </div>
                ))}
              </div>
            )}
            {modal === 'afw-edit' && (
              <>
                <p style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>Één afwijking per regel.</p>
                <textarea className="finput" rows={8} style={{ fontSize: 12 }} value={form.afw || ''} onChange={ev => setForm(p => ({ ...p, afw: ev.target.value }))} />
              </>
            )}
            {(modal === 'tb-nieuw' || modal === 'tb-edit') && (
              <div className="form-grid-2">
                <div className="fg full"><label className="flbl">Naam</label><input className="finput" value={form.naam || ''} onChange={ev => setForm(p => ({ ...p, naam: ev.target.value }))} /></div>
                <div className="fg full"><label className="flbl">Functie</label><input className="finput" value={form.functie || ''} onChange={ev => setForm(p => ({ ...p, functie: ev.target.value }))} /></div>
              </div>
            )}
            {(modal === 'proj-nieuw' || modal === 'proj-edit') && (
              <div className="form-grid-2">
                <div className="fg"><label className="flbl">Projectnummer (van klant)</label><input className="finput" value={form.nr || ''} onChange={ev => setForm(p => ({ ...p, nr: ev.target.value }))} /></div>
                <div className="fg"><label className="flbl">Projectnaam</label><input className="finput" value={form.naam || ''} onChange={ev => setForm(p => ({ ...p, naam: ev.target.value }))} /></div>
                <div className="fg full"><label className="flbl">Werkadres</label><input className="finput" value={form.werkadres || ''} onChange={ev => setForm(p => ({ ...p, werkadres: ev.target.value }))} /></div>
                <div className="fg full"><label className="flbl">Opdrachtomschrijving</label><textarea className="finput" rows={2} value={form.omschr || ''} onChange={ev => setForm(p => ({ ...p, omschr: ev.target.value }))} /></div>
                <div className="fg full">
                  <label className="flbl">Tekenbevoegde</label>
                  <select className="finput" value={form.tb_id || ''} onChange={ev => setForm(p => ({ ...p, tb_id: ev.target.value }))}>
                    <option value="">— Kies tekenbevoegde —</option>
                    {curKlant?.tekenbevoegden.map(t => <option key={t.id} value={t.id}>{t.naam}</option>)}
                  </select>
                </div>
              </div>
            )}
            <div className="modal-footer">
              <button className="btn btn-sm" onClick={() => setModal(null)}>Annuleren</button>
              <button className="btn btn-primary btn-sm" onClick={saveModal}>Opslaan</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── INSTELLINGEN ──────────────────────────────────────────────────────────
// ── VOORWAARDEN BEHEER ────────────────────────────────────────────────────────
const TEMPLATE_LABELS = {
  nl_zzp:     'ZZP overeenkomst — GTO Nederland',
  west_zzp:   'ZZP overeenkomst — GTO West',
  nl_klant:   'Klant overeenkomst — GTO Nederland',
  west_klant: 'Klant overeenkomst — GTO West',
}

function getVoorwaarden(db, templateKey, klantId = null) {
  // Klant-override: alleen voor klant-types, en alleen als de klant een eigen versie heeft
  if (klantId && (templateKey === 'nl_klant' || templateKey === 'west_klant')) {
    const klant = db.klanten.find(k => k.id === klantId)
    if (klant?.voorwaarden_override?.[templateKey]) {
      return klant.voorwaarden_override[templateKey]
    }
  }
  // Standaard voorwaarden
  return db.standaard_voorwaarden?.[templateKey] || []
}

function VoorwaardenScreen({ db, save, toast }) {
  const [selTemplate, setSelTemplate] = useState(null)
  const [selKlant, setSelKlant] = useState(null)
  const [openArtikelen, setOpenArtikelen] = useState({})
  const [editModal, setEditModal] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [editType, setEditType] = useState('numbered')
  // Drag state
  const dragArt = useRef(null)
  const dragSub = useRef(null)

  const voorwaarden = selTemplate ? getVoorwaarden(db, selTemplate, selKlant) : []
  const isKlantOverride = selKlant !== null && selTemplate && (selTemplate === 'nl_klant' || selTemplate === 'west_klant')
  const heeftOverride = isKlantOverride && !!db.klanten.find(k => k.id === selKlant)?.voorwaarden_override?.[selTemplate]

  function saveVoorwaarden(newArtikelen) {
    let newDb = { ...db }
    if (selKlant !== null) {
      const klanten = db.klanten.map(k => k.id !== selKlant ? k : {
        ...k, voorwaarden_override: { ...(k.voorwaarden_override || {}), [selTemplate]: newArtikelen }
      })
      newDb = { ...newDb, klanten }
    } else {
      newDb = { ...newDb, standaard_voorwaarden: { ...(db.standaard_voorwaarden || {}), [selTemplate]: newArtikelen } }
    }
    save(newDb)
  }

  function maakKlantOverride() {
    const kopie = JSON.parse(JSON.stringify(db.standaard_voorwaarden?.[selTemplate] || []))
    saveVoorwaarden(kopie)
    toast('Gepersonaliseerde versie aangemaakt')
  }

  function verwijderKlantOverride() {
    if (!confirm('Gepersonaliseerde versie verwijderen? De klant gebruikt dan weer het standaard document.')) return
    const klanten = db.klanten.map(k => {
      if (k.id !== selKlant) return k
      const o = { ...(k.voorwaarden_override || {}) }
      delete o[selTemplate]
      return { ...k, voorwaarden_override: o }
    })
    save({ ...db, klanten })
    toast('Gepersonaliseerde versie verwijderd')
  }

  function saveEdit() {
    if (!editModal) return
    const { type, artNr, subIdx } = editModal
    const arts = JSON.parse(JSON.stringify(voorwaarden))

    if (type === 'header') {
      const a = arts.find(a => a.nr === artNr)
      if (a) a.titel = editValue
    } else if (type === 'sub') {
      const a = arts.find(a => a.nr === artNr)
      if (a && a.subaartikelen[subIdx] !== undefined) {
        a.subaartikelen[subIdx].tekst = editValue
        a.subaartikelen[subIdx].type = editType
      }
    } else if (type === 'nieuw-sub') {
      const a = arts.find(a => a.nr === artNr)
      if (a && editValue.trim()) a.subaartikelen.push({ type: editType, tekst: editValue.trim() })
    } else if (type === 'nieuw-artikel') {
      if (editValue.trim()) arts.push({ nr: Math.max(0, ...arts.map(a => a.nr)) + 1, titel: editValue.trim(), subaartikelen: [] })
    }

    saveVoorwaarden(arts)
    setEditModal(null)
    toast('Opgeslagen')
  }

  function deleteSub(artNr, subIdx) {
    if (!confirm('Sub-artikel verwijderen?')) return
    const arts = JSON.parse(JSON.stringify(voorwaarden))
    const a = arts.find(a => a.nr === artNr)
    if (a) a.subaartikelen.splice(subIdx, 1)
    saveVoorwaarden(arts)
  }

  function deleteArtikel(artNr) {
    if (!confirm('Heel artikel verwijderen?')) return
    saveVoorwaarden(voorwaarden.filter(a => a.nr !== artNr))
  }

  function toggleSubType(artNr, subIdx) {
    const arts = JSON.parse(JSON.stringify(voorwaarden))
    const a = arts.find(a => a.nr === artNr)
    if (a && a.subaartikelen[subIdx]) {
      const cur = a.subaartikelen[subIdx].type || 'numbered'
      a.subaartikelen[subIdx].type = cur === 'numbered' ? 'list' : 'numbered'
    }
    saveVoorwaarden(arts)
    toast('Type gewijzigd')
  }

  // ── Drag & drop artikelen ─────────────────────────────────────────────────
  function onArtDragStart(e, idx) { dragArt.current = idx; e.dataTransfer.effectAllowed = 'move' }
  function onArtDragOver(e, idx) { e.preventDefault(); if (dragArt.current === idx) return }
  function onArtDrop(e, idx) {
    e.preventDefault()
    if (dragArt.current === null || dragArt.current === idx) return
    const arts = [...voorwaarden]
    const [moved] = arts.splice(dragArt.current, 1)
    arts.splice(idx, 0, moved)
    // Hernum artikelen op volgorde
    arts.forEach((a, i) => { a.nr = i + 1 })
    saveVoorwaarden(arts)
    dragArt.current = null
  }

  // ── Drag & drop sub-artikelen ─────────────────────────────────────────────
  function onSubDragStart(e, subIdx) { dragSub.current = subIdx; e.dataTransfer.effectAllowed = 'move'; e.stopPropagation() }
  function onSubDragOver(e, subIdx) { e.preventDefault(); e.stopPropagation() }
  function onSubDrop(e, artNr, subIdx) {
    e.preventDefault(); e.stopPropagation()
    if (dragSub.current === null || dragSub.current === subIdx) return
    const arts = JSON.parse(JSON.stringify(voorwaarden))
    const a = arts.find(a => a.nr === artNr)
    if (!a) return
    const [moved] = a.subaartikelen.splice(dragSub.current, 1)
    a.subaartikelen.splice(subIdx, 0, moved)
    saveVoorwaarden(arts)
    dragSub.current = null
  }

  const editorZichtbaar = voorwaarden.length > 0 && (heeftOverride || selKlant === null)

  return (
    <div>
      {/* Kies template */}
      <div className="card">
        <div className="card-hdr">Kies overeenkomst</div>
        <div className="form-grid-2">
          {Object.entries(TEMPLATE_LABELS).map(([key, label]) => (
            <div key={key}
              className={`ent-btn clickable ${selTemplate === key ? (key.startsWith('west') ? 'act-west' : 'act-nl') : ''}`}
              style={{ cursor: 'pointer', marginBottom: 6 }}
              onClick={() => { setSelTemplate(key); setSelKlant(null); setOpenArtikelen({}) }}>
              <img src={key.startsWith('west') ? '/logo-west.jpg' : '/logo-nederland.jpg'} alt=""
                style={{ height: 24, objectFit: 'contain' }} />
              {label}
            </div>
          ))}
        </div>
      </div>

      {/* Klant-override keuze (alleen voor klant-types) */}
      {selTemplate && (selTemplate === 'nl_klant' || selTemplate === 'west_klant') && (
        <div className="card">
          <div className="card-hdr">Wiens voorwaarden bewerken?</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className={`btn btn-sm ${selKlant === null ? 'btn-primary' : ''}`} onClick={() => setSelKlant(null)}>
              📄 Standaard document
            </button>
            {db.klanten.filter(k => k.voorwaarden_override?.[selTemplate]).map(k => (
              <button key={k.id} className={`btn btn-sm ${selKlant === k.id ? 'btn-primary' : ''}`}
                onClick={() => setSelKlant(k.id)}>🏢 {k.naam}</button>
            ))}
            <select className="finput" style={{ width: 'auto', fontSize: 12 }}
              onChange={ev => { if (ev.target.value) setSelKlant(parseInt(ev.target.value)) }} value="">
              <option value="">+ Klant met afwijkende voorwaarden...</option>
              {db.klanten.filter(k => !k.voorwaarden_override?.[selTemplate]).map(k => (
                <option key={k.id} value={k.id}>{k.naam}</option>
              ))}
            </select>
          </div>
          {selKlant !== null && !heeftOverride && (
            <div className="afw-box" style={{ marginTop: 10 }}>
              <div className="afw-title">Deze klant gebruikt momenteel het standaard document</div>
              <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={maakKlantOverride}>
                Maak gepersonaliseerde versie aan voor {db.klanten.find(k => k.id === selKlant)?.naam}
              </button>
            </div>
          )}
          {selKlant !== null && heeftOverride && (
            <div style={{ marginTop: 8, padding: '8px 12px', background: '#e8f3ec', borderRadius: 6, fontSize: 12, color: '#2a5a3a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>✅ {db.klanten.find(k => k.id === selKlant)?.naam} heeft een gepersonaliseerde versie</span>
              <button className="btn btn-sm btn-danger" onClick={verwijderKlantOverride}>Verwijder</button>
            </div>
          )}
        </div>
      )}

      {/* Artikel-editor met drag & drop */}
      {selTemplate && editorZichtbaar && (
        <div className="card">
          <div className="card-hdr">
            <span>
              {selKlant !== null
                ? `Voorwaarden — ${db.klanten.find(k => k.id === selKlant)?.naam}`
                : `Standaard — ${TEMPLATE_LABELS[selTemplate]}`}
            </span>
            {selKlant === null && (
              <span style={{ fontSize: 11, fontWeight: 400, color: '#e8651a' }}>
                ⚠ Wijzigingen gelden voor ALLE nieuwe overeenkomsten
              </span>
            )}
          </div>
          <p style={{ fontSize: 11, color: '#aaa', marginBottom: 10 }}>
            ☰ Sleep artikelen of sub-artikelen om de volgorde te wijzigen
          </p>

          {voorwaarden.map((art, artIdx) => (
            <div key={art.nr}
              draggable
              onDragStart={e => onArtDragStart(e, artIdx)}
              onDragOver={e => onArtDragOver(e, artIdx)}
              onDrop={e => onArtDrop(e, artIdx)}
              style={{ marginBottom: 8, border: '1px solid #eee', borderRadius: 8, overflow: 'hidden',
                       opacity: 1, cursor: 'grab' }}>

              {/* Artikel header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                            background: '#f8f8f8', userSelect: 'none' }}>
                <span style={{ color: '#ccc', fontSize: 16, cursor: 'grab' }}>☰</span>
                <span style={{ fontWeight: 700, fontSize: 13, flex: 1, cursor: 'pointer' }}
                  onClick={() => setOpenArtikelen(o => ({ ...o, [art.nr]: !o[art.nr] }))}>
                  {art.nr}. {art.titel}
                </span>
                <span style={{ color: '#bbb', fontSize: 11 }}>
                  {art.subaartikelen.filter(s => (s.type || 'numbered') === 'numbered').length} genummerd
                  {art.subaartikelen.filter(s => s.type === 'list').length > 0 &&
                    ` + ${art.subaartikelen.filter(s => s.type === 'list').length} opsomming`}
                </span>
                <button className="btn btn-sm" style={{ fontSize: 10 }}
                  onClick={() => { setEditModal({ type: 'header', artNr: art.nr }); setEditValue(art.titel) }}>✏ Titel</button>
                <button className="btn btn-sm btn-danger" style={{ fontSize: 10 }}
                  onClick={() => deleteArtikel(art.nr)}>×</button>
                <span style={{ color: '#bbb', cursor: 'pointer' }}
                  onClick={() => setOpenArtikelen(o => ({ ...o, [art.nr]: !o[art.nr] }))}>
                  {openArtikelen[art.nr] ? '▲' : '▼'}
                </span>
              </div>

              {/* Sub-artikelen */}
              {openArtikelen[art.nr] && (
                <div style={{ padding: '6px 12px' }}>
                  {art.subaartikelen.map((sub, subIdx) => {
                    const subType = sub.type || 'numbered'
                    const nummer = subType === 'numbered'
                      ? `${art.nr}.${art.subaartikelen.slice(0, subIdx).filter(s => (s.type || 'numbered') === 'numbered').length + 1}`
                      : null

                    return (
                      <div key={subIdx}
                        draggable
                        onDragStart={e => onSubDragStart(e, subIdx)}
                        onDragOver={e => onSubDragOver(e, subIdx)}
                        onDrop={e => onSubDrop(e, art.nr, subIdx)}
                        style={{ display: 'flex', gap: 6, alignItems: 'flex-start',
                                 padding: '5px 4px', borderBottom: '1px solid #f5f5f5',
                                 background: subType === 'list' ? '#fafbff' : 'white',
                                 marginLeft: subType === 'list' ? 16 : 0,
                                 borderLeft: subType === 'list' ? '2px solid #d0d8e8' : 'none',
                                 cursor: 'grab' }}>
                        <span style={{ color: '#ccc', fontSize: 12, paddingTop: 2 }}>☰</span>
                        <span style={{ minWidth: 36, fontSize: 11, color: '#999', paddingTop: 2 }}>
                          {subType === 'list' ? '—' : nummer}
                        </span>
                        <div style={{ flex: 1, fontSize: 12, lineHeight: 1.5, color: subType === 'list' ? '#555' : '#222' }}>
                          {sub.tekst}
                        </div>
                        {/* Type toggle knop */}
                        <button
                          title={subType === 'numbered' ? 'Maak opsomming (telt niet mee in nummering)' : 'Maak genummerd'}
                          className="btn btn-sm"
                          style={{ fontSize: 10, flexShrink: 0, color: subType === 'list' ? '#4a7c9e' : '#999' }}
                          onClick={() => toggleSubType(art.nr, subIdx)}>
                          {subType === 'list' ? '123' : '—'}
                        </button>
                        <button className="btn btn-sm" style={{ fontSize: 10, flexShrink: 0 }}
                          onClick={() => {
                            setEditModal({ type: 'sub', artNr: art.nr, subIdx })
                            setEditValue(sub.tekst)
                            setEditType(subType)
                          }}>✏</button>
                        <button className="btn btn-sm btn-danger" style={{ fontSize: 10, flexShrink: 0 }}
                          onClick={() => deleteSub(art.nr, subIdx)}>×</button>
                      </div>
                    )
                  })}
                  <button className="add-btn" style={{ marginTop: 6 }}
                    onClick={() => { setEditModal({ type: 'nieuw-sub', artNr: art.nr }); setEditValue(''); setEditType('numbered') }}>
                    + Sub-artikel toevoegen
                  </button>
                </div>
              )}
            </div>
          ))}

          <button className="add-btn" style={{ marginTop: 8 }}
            onClick={() => { setEditModal({ type: 'nieuw-artikel' }); setEditValue('') }}>
            + Nieuw artikel toevoegen
          </button>
        </div>
      )}

      {/* Edit modal */}
      {editModal && (
        <div className="modal-bg" onClick={ev => ev.target.className === 'modal-bg' && setEditModal(null)}>
          <div className="modal">
            <div className="modal-title">
              {{ sub: 'Sub-artikel bewerken', header: 'Artikel-titel bewerken',
                 'nieuw-sub': 'Sub-artikel toevoegen', 'nieuw-artikel': 'Nieuw artikel toevoegen' }[editModal.type]}
            </div>

            {/* Type-keuze voor sub-artikelen */}
            {(editModal.type === 'sub' || editModal.type === 'nieuw-sub') && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <button className={`btn btn-sm ${editType === 'numbered' ? 'btn-primary' : ''}`}
                  onClick={() => setEditType('numbered')}>
                  123 Genummerd (1.1, 1.2...)
                </button>
                <button className={`btn btn-sm ${editType === 'list' ? 'btn-primary' : ''}`}
                  onClick={() => setEditType('list')}>
                  — Opsomming (telt niet mee)
                </button>
              </div>
            )}

            {editModal.type === 'header' || editModal.type === 'nieuw-artikel'
              ? <input className="finput" value={editValue} onChange={ev => setEditValue(ev.target.value)} autoFocus />
              : <textarea className="finput" rows={5} style={{ resize: 'vertical' }} value={editValue}
                  onChange={ev => setEditValue(ev.target.value)} autoFocus />
            }
            <div className="modal-footer">
              <button className="btn btn-sm" onClick={() => setEditModal(null)}>Annuleren</button>
              <button className="btn btn-primary btn-sm" onClick={saveEdit}>Opslaan</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function InstellingenScreen({ db, save, toast }) {
  const [ts, setTs] = useState({ ...db.template_settings })
  function saveSets() { save({ ...db, template_settings: ts }); toast('Instellingen opgeslagen') }

  return (
    <div className="card">
      <div className="card-hdr">Template instellingen</div>
      <p style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>Aanpassingen hier worden direct toegepast op alle nieuwe overeenkomsten.</p>
      {[
        ['versie','Versienummer (bijv. 1/2026)'],
        ['einddatum_default','Standaard einddatum'],
        ['nl_zzp_footer_text','Modelovereenkomst referentie NL'],
        ['west_zzp_footer_text','Modelovereenkomst referentie West'],
      ].map(([f, lbl]) => (
        <div key={f} className="fg" style={{ marginBottom: 10 }}>
          <label className="flbl">{lbl}</label>
          <input className="finput" value={ts[f] || ''} onChange={ev => setTs(p => ({ ...p, [f]: ev.target.value }))} />
        </div>
      ))}
      <div style={{ marginTop: 16 }}><button className="btn btn-primary btn-sm" onClick={saveSets}>Opslaan</button></div>
      <div className="divider" style={{ margin: '20px 0' }} />
      <div className="card-hdr" style={{ marginBottom: 8 }}>Data beheer</div>
      <p style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>Export en import van alle data als JSON backup.</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-sm" onClick={() => {
          const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' })
          const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `gto_backup_${new Date().toISOString().slice(0,10)}.json`; a.click()
          toast('Backup gedownload')
        }}>⬇ Download backup (JSON)</button>
        <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
          ⬆ Herstel backup
          <input type="file" accept=".json" style={{ display: 'none' }} onChange={ev => {
            const f = ev.target.files[0]; if (!f) return
            const r = new FileReader(); r.onload = e => { try { save(JSON.parse(e.target.result)); toast('Backup hersteld') } catch { toast('Fout: ongeldig bestand') } }; r.readAsText(f)
          }} />
        </label>
      </div>
    </div>
  )
}
