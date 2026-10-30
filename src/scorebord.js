import './style.css'
import { renderTop, watchTop } from './api.js'

const list = document.getElementById('top')
const empty = document.getElementById('top-leeg')
const count = document.getElementById('aantal')

watchTop(({ top, players }) => {
  empty.hidden = top.length > 0
  count.textContent = players === 1 ? '1 deelnemer' : `${players} deelnemers`
  renderTop(list, top)
})
