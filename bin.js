#!/usr/bin/env node

/* eslint-disable guard-for-in */

'use strict'

const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const sha2 = (str) => crypto.createHash('sha256').update(str).digest('hex')

const TeleBot = require('telebot')
const bot = new TeleBot(process.argv[2])
// const URI = require('urijs')

const yaml = require('js-yaml')
const config = yaml.safeLoad(String(fs.readFileSync(path.join(__dirname, 'config.yaml'))))

const Sentry = require('@sentry/node')
Sentry.init({dsn: process.env.SENTRY_DSN})

const pino = require('pino')
const log = pino({name: 'tg-crypto-spam-bot'})

const wordlist = []
const urllist = []
const {scores, actions} = config

const db = fs.createWriteStream(process.env.CAPTURE_FILE || 'captures.json', {flags: 'a'})
const collect = (data) => db.write(JSON.stringify(data) + '\n')

for (const group in config.wordlists) {
  let {score, words} = config.wordlists[group]
  words.forEach(word => wordlist.push({word, group, score}))
}

for (const group in config.urllists) {
  let {score, domains} = config.urllists[group]
  domains.forEach(domain => urllist.push({domain, group, score}))
}

const origOn = bot.on.bind(bot)
bot.on = (ev, fnc, ...a) => {
  origOn(ev, async (msg, ...a) => {
    try {
      let res = await fnc(msg, ...a)
      return res
    } catch (e) {
      log.error(e)
      Sentry.captureException(e)
    }
  }, ...a)
}

bot.on(['/start', '/hello'], (msg) => msg.reply.text('This bot helps you to get rid of crypto spam in your group!', {webPreview: false}))

const handle = (msg) => {
  if (msg.type === 'private') {
    return
  }

  let urls = msg.text.match(/(http(s)?:\/\/.)?(www\.)?[-a-zA-Z0-9@:%._+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_+.~#?&//=]*)/gmi) || []
  let words = msg.text.match(/\w+/gmi).map(w => w.toLowerCase())
  let hasTGUrl = msg.text.indexOf('t.me/joinchat') !== -1

  let forbiddenWords = wordlist.filter(({word}) => words.indexOf(word) !== -1)
  let hostnamesOnly = urls.map(url => new URL(url).hostname)
  let forbiddenUrls = urllist.filter(({domain}) => hostnamesOnly.indexOf(domain) !== -1)

  let score = forbiddenWords.reduce((a, b) => a + b.score, 0) +
    forbiddenUrls.reduce((a, b) => a + b.score, 0) +
    (scores.isABot * msg.from.is_bot) +
    (scores.url * urls.length) +
    (scores.tgUrl * hasTGUrl)

  if (process.env.NODE_ENV !== 'production') {
    console.log(msg) // eslint-disable-line no-console
    msg.reply.text(JSON.stringify({urls, words, hasTGUrl, score}))
  }

  if (actions.del <= score) {
    let uniq = sha2(msg.chat_id + '@' + msg.message_id)
    msg.reply.text(`Deleted crypto spam because score ${score} - If this was a mistake then create an issue here https://github.com/mkg20001/tg-anti-crypto-spam-bot/issues/new?title=[wrongful%20deletion]%20${uniq}`, {render_web: false})
    bot.deleteMessage(msg.chat.id, msg.message_id)
    collect({score, text: msg.text, data: {words, urls, forbiddenWords, forbiddenUrls, hasTGUrl}, id: uniq})
  }

  if (actions.ban <= score) {
  } else if (actions.kick <= score) {
  }
}

bot.on('forward', handle)
bot.on('text', handle)

bot.start()
