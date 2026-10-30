import './style.css'
import { messageFor, rpc } from './api.js'

const $ = (id) => document.getElementById(id)
const CODE_KEY = 'lens-winactie-beheer'
let code = sessionStorage.getItem(CODE_KEY) ?? ''
let participants = []

const toLocal = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
const fromLocal = (v) => (v ? new Date(v).toISOString() : null)
const time = (iso) => (iso ? new Date(iso).toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' }) : '')
const prize = (p) => [
  p.rank && p.rank <= 3 ? 'Masterclass' : '',
  p.finished_at && !p.hidden && p.score > 50 ? '€100 korting' : '',
].filter(Boolean).join(' + ')

function button(label, onClick) {
  const b = document.createElement('button')
  b.className = 'btn btn-ghost btn-sm'
  b.textContent = label
  b.addEventListener('click', onClick)
  return b
}

async function act(name, args) {
  await rpc(name, { p_code: code, ...args })
  await load()
}

function renderRows() {
  $('rijen').replaceChildren(...participants.map((p) => {
    const tr = document.createElement('tr')
    if (p.hidden || !p.finished_at) tr.className = 'muted'
    const cells = [p.rank ?? '', p.first_name, p.finished_at ? p.score : 'Nog geen', prize(p), p.phone, p.email, time(p.finished_at || p.started_at)]
    for (const text of cells) {
      const td = document.createElement('td')
      td.textContent = text
      tr.append(td)
    }
    const actions = document.createElement('td')
    actions.append(
      button('Score', () => {
        const value = prompt(`Nieuwe score voor ${p.first_name}`, p.finished_at ? p.score : '')
        if (value === null || value.trim() === '' || !Number.isInteger(Number(value))) return
        act('admin_set_score', { p_id: p.id, p_score: Number(value) })
      }),
      ' ',
      button(p.hidden ? 'Tonen' : 'Verbergen', () => act('admin_set_hidden', { p_id: p.id, p_hidden: !p.hidden })),
      ' ',
      button('Verwijder', () => {
        if (confirm(`${p.first_name} en alle gegevens definitief verwijderen?`)) act('admin_delete', { p_id: p.id })
      }),
    )
    tr.append(actions)
    return tr
  }))
  $('aantal').textContent = participants.length === 1 ? '1 inschrijving' : `${participants.length} inschrijvingen`
}

async function load() {
  const data = await rpc('admin_overview', { p_code: code })
  participants = data.participants
  const s = data.settings
  $('standcode').value = s.stand_code
  $('maxscore').value = s.max_score
  $('start').value = toLocal(s.starts_at)
  $('eind').value = toLocal(s.ends_at)
  renderRows()
}

$('form-login').addEventListener('submit', async (e) => {
  e.preventDefault()
  code = $('beheercode').value.trim()
  $('fout-login').hidden = true
  try {
    await load()
    sessionStorage.setItem(CODE_KEY, code)
    $('login').hidden = true
    $('paneel').hidden = false
  } catch (err) {
    $('fout-login').textContent = messageFor(err.message)
    $('fout-login').hidden = false
  }
})

$('form-instellingen').addEventListener('submit', async (e) => {
  e.preventDefault()
  await act('admin_set_settings', {
    p_starts: fromLocal($('start').value),
    p_ends: fromLocal($('eind').value),
    p_stand_code: $('standcode').value,
    p_max_score: Number($('maxscore').value),
  })
  $('opgeslagen').hidden = false
  setTimeout(() => { $('opgeslagen').hidden = true }, 2000)
})

$('ververs').addEventListener('click', load)

$('export').addEventListener('click', () => {
  const header = ['Plek', 'Voornaam', 'Telefoon', 'E-mail', 'Score', 'Prijs', 'Ingeschreven', 'Score ingevuld', 'Verborgen']
  const rows = participants.map((p) => [p.rank ?? '', p.first_name, p.phone, p.email, p.finished_at ? p.score : '', prize(p), time(p.started_at), time(p.finished_at), p.hidden ? 'ja' : 'nee'])
  const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(';')).join('\r\n')
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  link.download = 'lens-ai-winactie-deelnemers.csv'
  link.click()
  URL.revokeObjectURL(link.href)
})

if (code) {
  $('beheercode').value = code
  $('form-login').requestSubmit()
}
