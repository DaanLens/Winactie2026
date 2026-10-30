import { createClient } from '@supabase/supabase-js'

// Publieke waarden: de beveiliging zit in de databasefuncties, niet in deze sleutel.
export const supabase = createClient(
  'https://jcvpgnikokuubeqvjrah.supabase.co',
  'sb_publishable_Coy_yS8cKpcDjlnhkhKUCQ_rIx9tpcy',
  { auth: { persistSession: false, autoRefreshToken: false } },
)

export async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message)
  return data
}

const MESSAGES = {
  gesloten: 'De actie is nu niet open.',
  geen_toestemming: 'Vink allebei de vakjes aan om mee te doen.',
  ongeldige_naam: 'Vul je voornaam in, alleen met letters.',
  ongeldig_telefoonnummer: 'Dit telefoonnummer klopt niet. Vul het in als 06 12345678.',
  ongeldig_email: 'Dit e-mailadres klopt niet.',
  prive_email: 'Gebruik je zakelijke e-mailadres. Privéadressen zoals Gmail of Outlook doen niet mee.',
  al_meegedaan: 'Met dit e-mailadres of telefoonnummer is al meegedaan. Iedereen speelt één keer.',
  te_druk: 'Het is even druk. Probeer het over een minuut opnieuw.',
  al_ingevuld: 'Je score staat er al in.',
  foute_code: 'Die code klopt niet. Vraag de code aan iemand van LENS AI.',
  te_vaak_fout: 'Te vaak een foute code. Vraag iemand van LENS AI om je score in te vullen.',
  ongeldige_score: 'Deze score kan niet. Controleer het getal.',
  onbekend: 'We vinden je inschrijving niet meer. Vul je gegevens opnieuw in.',
  geen_toegang: 'Deze beheercode klopt niet.',
}

export function messageFor(code) {
  return MESSAGES[code] ?? 'Er ging iets mis. Probeer het opnieuw.'
}

export function renderTop(list, players) {
  list.replaceChildren(...players.map((p, i) => {
    const li = document.createElement('li')
    for (const [cls, text] of [['pos', i + 1], ['name', p.first_name], ['pts', p.score]]) {
      const span = document.createElement('span')
      span.className = cls
      span.textContent = text
      li.append(span)
    }
    return li
  }))
}

// Live via een broadcast vanuit de database; de timer vangt een weggevallen verbinding op.
export function watchTop(onChange) {
  const refresh = () => rpc('get_top5').then(onChange).catch(() => {})
  refresh()
  supabase.channel('scorebord').on('broadcast', { event: 'update' }, refresh).subscribe()
  setInterval(refresh, 15000)
}
