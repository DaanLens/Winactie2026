import './style.css'
import { messageFor, renderTop, rpc, watchTop } from './api.js'

const STORAGE_KEY = 'lens-winactie-token'
const $ = (id) => document.getElementById(id)

function getToken() {
  try { return localStorage.getItem(STORAGE_KEY) } catch { return null }
}
function setToken(token) {
  try { localStorage.setItem(STORAGE_KEY, token) } catch { /* werkt ook zonder */ }
}

let token = getToken()

function show(step) {
  for (const id of ['stap-inschrijven', 'stap-score', 'stap-klaar']) $(id).hidden = id !== step
  $('uitleg').hidden = step !== 'stap-inschrijven'
}

function showScoreStep(state) {
  $('groet').textContent = `Succes, ${state.first_name}.`
  $('score').max = state.max_score
  show('stap-score')
}

function showResult(state) {
  $('klaar-naam').textContent = `Goed gespeeld, ${state.first_name}.`
  $('klaar-score').textContent = state.score
  $('klaar-plek').textContent = `Je staat nu op plek ${state.rank}.`
  $('klaar-top3').hidden = state.rank > 3
  $('klaar-korting').hidden = !state.discount
  show('stap-klaar')
}

async function submitWith(button, errorEl, action) {
  errorEl.hidden = true
  button.disabled = true
  try {
    await action()
  } catch (e) {
    errorEl.textContent = messageFor(e.message)
    errorEl.hidden = false
  } finally {
    button.disabled = false
  }
}

$('form-inschrijven').addEventListener('submit', (e) => {
  e.preventDefault()
  const f = e.target
  submitWith(f.querySelector('button'), $('fout-inschrijven'), async () => {
    const res = await rpc('register', {
      p_first_name: f.voornaam.value,
      p_phone: f.telefoon.value,
      p_email: f.email.value,
      p_terms: f.voorwaarden.checked,
      p_contact: f.contact.checked,
    })
    token = res.token
    setToken(token)
    showScoreStep(await rpc('get_state', { p_token: token }))
  })
})

$('form-score').addEventListener('submit', (e) => {
  e.preventDefault()
  const f = e.target
  submitWith(f.querySelector('button'), $('fout-score'), async () => {
    if (f.score.value.trim() === '') throw new Error('ongeldige_score')
    const res = await rpc('submit_score', {
      p_token: token,
      p_stand_code: f.code.value,
      p_score: Number(f.score.value),
    })
    if (res.error) throw new Error(res.error)
    showResult(res)
  })
})

watchTop(({ top }) => {
  $('top-leeg').hidden = top.length > 0
  renderTop($('top'), top)
})

if (token) {
  rpc('get_state', { p_token: token })
    .then((state) => (state.done ? showResult(state) : showScoreStep(state)))
    .catch(() => show('stap-inschrijven'))
}
