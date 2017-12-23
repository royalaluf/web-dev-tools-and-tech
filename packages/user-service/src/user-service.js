'use strict'
const {promisify: p} = require('util')
const express = require('express')
const bodyParser = require('body-parser')
const redis = require('redis')
const bcrypt = require('bcryptjs')
const uuid = require('uuid')

module.exports = createApp

function createApp({redisAddress}) {
  let redisClientCache
  const redisClient = async () =>
    redisClientCache ||
    (redisClientCache = new Promise((resolve, reject) => {
      const client = new redis.createClient({url: `//${redisAddress}`})
        .on('error', reject)
        .on('ready', () => resolve(client))
    }))

  const app = express()
  app.set('etag', false)

  app.get('/', (req, res) => res.send('OK'))

  app.post(
    '/signup',
    bodyParser.json(),
    captureAsyncErrors(async (req, res) => {
      const {email, name, password} = req.body
      const id = uuid.v4()

      if (await getUserKey('authenticatoin', email)) {
        return res.status(400).send('user email alreadusy exists')
      }

      const salt = await bcrypt.genSalt(2)
      const passwordHash = await bcrypt.hash(password, salt)

      await setUserKey('profile', id, {email, name}),
        await setUserKey('authentication', email, {id, passwordHash})

      res.json({id})
    }),
  )

  app.get(
    '/authenticate',
    captureAsyncErrors(async (req, res) => {
      const {email, password} = req.query

      const emailInfo = await getUserKey('authentication', email)
      if (!emailInfo) {
        res.status(404).send('user email does not exist')
      }

      const {id, passwordHash} = emailInfo
      if (await bcrypt.compare(password, passwordHash)) {
        res.send('')
      } else {
        res.status(401).send('')
      }
    }),
  )

  app.get(
    '/user/profile/:id',
    captureAsyncErrors(async (req, res) => {
      const {id} = req.params

      // {email, name}
      res.json(await getUserKey('profile', id))
    }),
  )

  app.put(
    '/user/profile/:id',
    captureAsyncErrors(async (req, res) => {
      const {id} = req.params

      // {email, name}
      await setUserKey('profile', id)

      res.send('')
    }),
  )

  app.get(
    '/user/data/:id',
    captureAsyncErrors(async (req, res) => {
      const {id} = req.params

      return res.json(await getUserKey('data', id))
    }),
  )

  app.put(
    '/user/data/:id',
    bodyParser.json(),
    captureAsyncErrors(async (req, res) => {
      const {id} = req.params

      await setUserKey('data', id, req.body)

      res.send('')
    }),
  )

  app.dispose = async () => {
    const client = await redisClient()

    await client.quit()
  }

  return app

  async function setUserKey(category, id, value) {
    const client = await redisClient()

    await p(client.set.bind(client))(`user:${category}:${id}`, JSON.stringify(value))
  }

  async function getUserKey(category, id) {
    const client = await redisClient()

    return await p(client.get.bind(client))(`user:${category}:${id}`)
  }
}

const captureAsyncErrors = handler => (req, res, ...args) => {
  handler(req, res, ...args).catch(err => {
    console.error(`Exception in ${req.url}:\n`, err.stack)

    res.status(500).send(err.stack)
  })
}
