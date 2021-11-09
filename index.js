const AWS = require('aws-sdk')
const Pino = require('pino')
const RegistryResolver = require('@flossbank/registry-resolver')
const Process = require('./lib/process')
const Config = require('./lib/config')
const Db = require('./lib/mongo')
const S3 = require('./lib/s3')

const kms = new AWS.KMS({ region: 'us-west-2' })
const awsS3 = new AWS.S3({ apiVersion: '2006-03-01' })

/*
- Gets package weights map from s3
- Distributes donations to all packages in mongo
- Takes OSS snapshot for the organization
- Deletes the correlation ID files from s3
*/
exports.handler = async (event) => {
  const log = Pino()
  const config = new Config({ log, kms })
  const s3 = new S3({ s3: awsS3, config })

  const db = new Db({ log, config })
  await db.connect()

  const resolver = new RegistryResolver({ log })

  let results
  try {
    results = await Promise.all(
      event.Records.map(record => Process.process({ record, db, resolver, log, s3 }))
    )
    if (!results.every(result => result.success)) {
      throw new Error(JSON.stringify(results))
    }
    return results
  } finally {
    await db.close()
  }
}
