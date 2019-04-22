#!/usr/bin/env node

'use strict'

const os = require('os')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const sha2 = (str) => crypto.createHash('sha256').update(str).digest('hex')

const TeleBot = require('telebot')
const bot = new TeleBot(process.argv[2])
const URI = require('urijs')

const ERROR_REPLY = 'Boom!\nYou just made this bot go kaboom!\nHave a :cookie:!'

const yaml = require('js-yaml')
const config = yaml.safeLoad(String(fs.readFileSync(path.join(__dirname, 'config.yaml'))))

const Sentry = require('@sentry/node')
Sentry.init({dsn: process.env.SENTRY_DSN})

const pino = require('pino')
const log = pino({name: 'tg-crypto-spam-bot'})

const wordlist = []
const {scores, actions} = config

const db = fs.createWriteStream(process.env.CAPTURE_FILE || 'captures.json', {flags: 'a'})
const collect = (data) => db.write(JSON.stringify(data) + '\n')

for (const group in config.wordlists) {
  let {score, words} = config.wordlists[group]
  words.forEach(word => wordlist.push({word, group, score}))
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
      try {
        msg.reply.text(ERROR_REPLY)
      } catch (e) {
        // ignore
      }
    }
  }, ...a)
}

bot.on(['/start', '/hello'], (msg) => msg.reply.text('This bot helps you to get rid of crypto spam in your group!', {webPreview: false}))

bot.on('text', (msg) => {
  console.log(msg)
  
  if (msg.type === 'private') {
    return
  }
  
  let urls = []
  let words = msg.text.match(/\w+/gmi).map(w => w.toLowerCase())
  let hasTGUrl = false // t.me/joinchat, etc
  
  let forbiddenWords = wordlist.filter(({word}) => words.indexOf(word) !== -1)
  
  let score = forbiddenWords.reduce((a, b) => a + b.score, 0) +
    (scores.isABot * msg.from.is_bot) +
    (scores.url * urls.length) +
    (scores.tgUrl * hasTGUrl)

  // msg.reply.text(JSON.stringify({urls, words, hasTGUrl, score}))

  if (actions.del <= score) {
    let uniq = sha2(msg.chat_id + '@' + msg.message_id)
    msg.reply.text(`Deleted crypto spam ${uniq} - Beta, complain with this ID in your issues if this was a mistake`)
    bot.deleteMessage(msg.chat.id, msg.message_id)
    collect({score, text: msg.text, data: {words, urls, forbiddenWords, hasTGUrl}, id: uniq})
  }
  
  if (actions.kick <= score) {
  } else if (actions.ban <= score) {
  }
  
})

bot.start()
