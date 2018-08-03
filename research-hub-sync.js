#!/usr/bin/env node
'use strict'

const contentful = require('contentful')
const chalk = require('chalk')
const Table = require('cli-table2')
const program = require('commander')
const changeCase = require('change-case')
const elasticsearch = require('elasticsearch')

program
.version('0.0.1')
.usage('[options] <content_type>')
.option('-v, --verbose', 'include detailed error messages')
.option('-s, --summary', 'print summary of content that will be uploaded')
.option('-r, --reset', 'delete and re-create existing ElasticSearch index of the same name')
.option('-c, --no-create-index', 'fail instead of automatically creating the ElasticSearch index')
.option('-e, --env <environment id>', 'contentful environment id (default master)')
.option('-i, --index <index name>',
  "ElasticSearch index name to use. Defaults to research-hub-{env}-{content_type} e.g. 'research-hub-master-articles'."
  + " camelCase names will be converted to param-case to meet ElasticSearch index name requirements.")
.parse(process.argv)

if (program.args.length !== 1) {
  program.outputHelp()
  process.exit(1)
}

/* Environment Variables */
const SPACE_ID = process.env.CONTENTFUL_SPACE_ID
const ACCESS_TOKEN = process.env.CONTENTFUL_ACCESS_TOKEN
const ELASTICSEARCH_HOST = process.env.ELASTICSEARCH_HOST || 'localhost'
const ELASTICSEARCH_PORT = process.env.ELASTICSEARCH_PORT || 9200

/* Script parameters */
const CONTENT_TYPE = program.args[0]
const ENVIRONMENT = program.env || 'master'
const INDEX_NAME = program.index || ('research-hub-' + ENVIRONMENT + '-' + changeCase.paramCase(CONTENT_TYPE))
const VERBOSE = program.verbose
const SUMMARY = program.summary
const CREATE_INDEX = program.createIndex
const RESET = program.reset

function logTable(items) {

  const responseTable = new Table({
    head: [chalk.blue.bold('sys.id'), chalk.blue.bold('field.name')]
  })

  items.forEach( (entry) => {
    responseTable.push([entry.sys.id, entry.fields.name ])
  })

  console.log("\n" + responseTable.toString() + "\n")

}

async function postItems(items, esClient) {

  // check if index exists
  const esIndexExists = await esClient.indices.exists({ index: INDEX_NAME })
  .catch(e => {
    if (VERBOSE) console.error(e)
  })
  console.log(chalk.blue(`${esIndexExists ? good : bad}\tExisting index `) + chalk.blue.bold(INDEX_NAME)
   + chalk.blue(` was${esIndexExists ? '' : ' not'} found`))

  // delete and re-create the index if --reset flag
  if (RESET && esIndexExists) {
    console.log(chalk.blue.bold('\t--reset flag is set; Deleting the existing index...'))
    const res = await esClient.indices.delete({index: INDEX_NAME})
    .catch(e => {
      if (VERBOSE) console.error(e)
    })
    console.log(chalk.blue(`${res.acknowledged ? good : bad}\tDeleted existing index`))
  }

  // create index if not exists
  if ((CREATE_INDEX && !esIndexExists) || RESET) {
    const esIndexCreate = await esClient.indices.create({ index: INDEX_NAME })
    .catch(e => {
      if (VERBOSE) console.error(e)
    })
    console.log(chalk.blue(`${esIndexCreate.acknowledged ? good : bad}\tAutomatically created index ${INDEX_NAME}`))
  } else if (!esIndexExists) {
    console.log(chalk.blue('--no-create-index is set; Not creating the index.\n'))
    return 1
  }

  /*
   // create schema

   const schema = {
    title: { type: 'keyword' },
    author: { type: 'keyword' },
    location: { type: 'integer' },
    text: { type: 'text' }
  }

  await esClient.indices.putMapping({
    index: INDEX_NAME,
    body: { properties: schema }
  })
  */

  // post docs to index

  var fails = 0
  for (const item of items) {
    await esClient.create({
      index: INDEX_NAME,
      type: '_doc',
      id: item.sys.id,
      body: item
    }).catch(e => {
      console.log(chalk.red(e.message))
      fails += 1
     })
  }

  console.log(chalk.blue(`${fails === 0 ? good : bad}\tPosted ${ items.length-fails } ${CONTENT_TYPE}s (${ fails } failed)`))

  return fails
}

async function doSync(contentfulClient, esClient) {

  // TODO: pagination if more than 1000 entries
  const response = await contentfulClient.getEntries({
    skip: 0,
    limit: 1000,
    content_type: CONTENT_TYPE
  }).catch(e => {
    if (VERBOSE) console.error(e)
  })

  console.log(chalk.blue(`${response ? good : bad}\tRetrieve ${CONTENT_TYPE} items from Contentful`))

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
    return await postItems(response.items, esClient)
  } else {
    console.log(chalk.red.bold("\nAborting sync.\n"))
    return 1
  }
}

console.log(chalk.green.bold('\nContentful ElasticSearch Sync'))

const infoTable = new Table()
infoTable.push([chalk.white('ES instance host'), chalk.white.bold(ELASTICSEARCH_HOST)])
infoTable.push([chalk.white('ES instance port'), chalk.white.bold(ELASTICSEARCH_PORT)])
infoTable.push([chalk.white('ES Index name'), chalk.white.bold(INDEX_NAME)])
infoTable.push([chalk.white('Contentful Space ID'), chalk.white.bold(SPACE_ID)])
infoTable.push([chalk.white('Contentful content_type'), chalk.white.bold(CONTENT_TYPE)])
infoTable.push([chalk.white('Contentful environment ID'), chalk.white.bold(ENVIRONMENT)])

console.log("\n" + infoTable.toString() + "\n")

const good = '👌';
const bad = '😕';

( async () => {
  try {

    console.log(chalk.blue(`${SPACE_ID && ACCESS_TOKEN && ELASTICSEARCH_HOST && ELASTICSEARCH_PORT ? good : bad}\tGet required env vars`))

    const contentfulClient = contentful.createClient({
      space: SPACE_ID,
      environment: ENVIRONMENT,
      accessToken: ACCESS_TOKEN
    })

    const esClient = new elasticsearch.Client({
      host: {
        host: ELASTICSEARCH_HOST,
        port: ELASTICSEARCH_PORT
      },
      log: VERBOSE ? ['trace'] : [],
      apiVersion: '6.3'
    })

    const esHealth = await esClient.cluster.health({
      timeout: '2s',
    })
    .catch(e => {
      if (VERBOSE) console.error(e)
    })

    console.log(chalk.blue(`${esHealth ? good : bad}\tConnect to ElasticSearch instance`))

    if (esHealth && contentfulClient) {
      if (VERBOSE) console.log(esHealth)
      const status = await doSync(contentfulClient, esClient)
      process.exit(status ? 1 : 0)
    } else {
      console.log(chalk.red.bold("\nAborting sync.\n"))
      process.exit(1)
    }

  } catch (e) {
    if(VERBOSE) console.error(e)
  }

})()

