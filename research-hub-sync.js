#!/usr/bin/env node
'use strict'

const contentful = require('contentful')
const chalk = require('chalk')
const Table = require('cli-table2')
const request = require('request-promise')
const program = require('commander')

program
.version('0.0.1')
.usage('[options] <content_type>')
.option('-v, --verbose', 'Include detailed error messages')
.option('-s, --summary', 'Print summary of content that will be uploaded')
.option('-e, --env <environment id>', 'Contentful environment id (default master)')
.option('-i, --index <index name>',
  "ElasticSearch index name (default research-hub-{env}-{content_type} e.g. 'research-hub-master-articles')")
.parse(process.argv)

if (program.args.length !== 1) {
  program.outputHelp()
  process.exit(1)
}

/* Environment Variables */
const SPACE_ID = process.env.CONTENTFUL_SPACE_ID
const ACCESS_TOKEN = process.env.CONTENTFUL_ACCESS_TOKEN
const ELASTICSEARCH_URL = process.env.ELASTICSEARCH_URL

/* Script parameters */
const CONTENT_TYPE = program.args[0]
const ENVIRONMENT = program.env || 'master'
const INDEX_NAME = program.index || ('research-hub-' + ENVIRONMENT + '-' + CONTENT_TYPE)
const VERBOSE = program.verbose
const SUMMARY = program.summary


function logTable(items) {

  const responseTable = new Table({
    head: [chalk.blue.bold('sys.id'), chalk.blue.bold('field.name')]
  })

  items.forEach( (entry) => {
    responseTable.push([entry.sys.id, entry.fields.name ])
  })

  console.log("\n" + responseTable.toString() + "\n")

 // console.log(JSON.stringify(response.items[0]))

}

async function postItems(items) {

  var fails = 0

  for (const item of items) {
    /* Assumes that everything in uri is urlencoded! */
    const postResult = await request({
      method: 'PUT',
      uri: `${ELASTICSEARCH_URL}/${INDEX_NAME}/_doc/${item.sys.id}`,
      body: item,
      json: true
    })
    .catch (e => {
      if (VERBOSE) console.error(e)
      fails += 1
    })
    // TODO: use ES bulk upload?
  }

  console.log(chalk.blue(`${fails === 0 ? good : bad}\tPosted ${ items.length-fails } ${CONTENT_TYPE}s (${ fails } failed)`))
  console.log(chalk.green.bold("\nFinished!\n"))

  return fails
}

async function doSync(client) {

    // TODO: pagination if more than 1000 entries
    const response = await client.getEntries({
      skip: 0,
      limit: 1000,
      content_type: CONTENT_TYPE
    }).catch(e => {
      if (VERBOSE) console.error(e)
    })

    console.log(chalk.blue(`${response ? good : bad}\tTest connection to Contentful`))

    if (response) {
      console.log(
        chalk.blue(`${response.items.length > 0 ? good : bad}\tFound `)
        + chalk.blue.bold(response.items.length)
        + chalk.blue(` entries of type `)
        + chalk.blue.bold(CONTENT_TYPE)
      )
   }

   if (response && response.items.length > 0) {
     if (SUMMARY) logTable(response.items)
     return await postItems(response.items)
   } else {
     console.log(chalk.red.bold("\nAborting sync.\n"))
     return 1
   }
}



console.log(chalk.green.bold('\nContentful ElasticSearch Sync'))

const infoTable = new Table()
infoTable.push([chalk.white('ES instance'), chalk.white.bold(ELASTICSEARCH_URL)])
infoTable.push([chalk.white('ES Index name'), chalk.white.bold(INDEX_NAME)])
infoTable.push([chalk.white('Contentful Space ID'), chalk.white.bold(SPACE_ID)])
infoTable.push([chalk.white('Contentful content_type'), chalk.white.bold(CONTENT_TYPE)])
infoTable.push([chalk.white('Contentful environment ID'), chalk.white.bold(ENVIRONMENT)])

console.log("\n" + infoTable.toString() + "\n")

const good = '👌';
const bad = '😕';

( async () => {
  try {

    const client = contentful.createClient({
      space: SPACE_ID,
      environment: ENVIRONMENT,
      accessToken: ACCESS_TOKEN
    })

    console.log(chalk.blue(`${SPACE_ID && ACCESS_TOKEN && ELASTICSEARCH_URL ? good : bad}\tGet required env vars`))

    const esHealth = await request.get(`${ELASTICSEARCH_URL}/_cat/health`)
    .catch (e => {
      if (VERBOSE) console.error(e)
    })

    console.log(chalk.blue(`${esHealth ? good : bad}\tConnect to ElasticSearch instance`))

    if (esHealth && client) {
      const status = await doSync(client)
      process.exit(status ? 1 : 0)
    } else {
      console.log(chalk.red.bold("\nAborting sync.\n"))
      process.exit(1)
    }

  } catch (e) {
    if(VERBOSE) console.error(e)
  }

})()

