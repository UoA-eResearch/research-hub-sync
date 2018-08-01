'use strict'

const contentful = require('contentful')
const chalk = require('chalk')
const Table = require('cli-table2')
const request = require('request-promise')

/* Environment Variables */
const SPACE_ID = process.env.CONTENTFUL_SPACE_ID
const ACCESS_TOKEN = process.env.CONTENTFUL_ACCESS_TOKEN
const ELASTICSEARCH_URL = process.env.ELASTICSEARCH_URL

/* Script parameters */
const CONTENT_TYPE = process.argv[2] || 'contentItem'
const INDEX_NAME = process.argv[3] || 'research-hub-master-articles'
const ENVIRONMENT = process.argv[4] || 'master'

/* Flags  */
// TODO: parse flags from argv
const VERBOSE = true  // Logs content items if true
const QUIET = false // Silences errors if true

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
      if (!QUIET) console.error(e)
      fails += 1
    })
  }

  console.log(chalk.blue(`${fails === 0 ? good : bad}\tPosted ${ items.length-fails } ${CONTENT_TYPE}s (${ fails } failed)`))

  console.log(chalk.green.bold("\nFinished!\n"))
}

async function doSync(client) {

    // TODO: pagination if more than 1000 entries
    const response = await client.getEntries({
      skip: 0,
      limit: 1000,
      content_type: CONTENT_TYPE
    }).catch(e => {
      if (!QUIET) console.error(e)
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
     if (VERBOSE) logTable(response.items)
     await postItems(response.items)
   } else {
     console.log(chalk.red.bold("\nAborting sync.\n"))
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

const good = '✓';
const bad = '😕';

( async () => {
  try {

    const client = contentful.createClient({
      space: SPACE_ID,
      environment: ENVIRONMENT,
      accessToken: ACCESS_TOKEN
    })

    console.log(chalk.blue(`${SPACE_ID && ACCESS_TOKEN && ELASTICSEARCH_URL ? good : bad}\tGet required env vars`))
    console.log(chalk.blue(`${CONTENT_TYPE && INDEX_NAME && ENVIRONMENT ? good : bad}\tGet required script params`))

    const esHealth = await request.get(`${ELASTICSEARCH_URL}/_cat/health`)
    .catch (e => {
      if (!QUIET) console.error(e)
    })

    console.log(chalk.blue(`${esHealth ? good : bad}\tConnect to ElasticSearch instance`))

    if (esHealth && client) {
      await doSync(client)
    } else {
      console.log(chalk.red.bold("\nAborting sync.\n"))
    }

  } catch (e) {
    if(!QUIET) console.error(e)
  }

})()

