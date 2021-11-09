const test = require('ava')
const sinon = require('sinon')
const S3 = require('../lib/s3')

test.before((t) => {
  sinon.stub(Date, 'now').returns(1234)

  const jsPkgWeightsMap = new Map()
  jsPkgWeightsMap.set('js-deep-equals', 0.1)
  jsPkgWeightsMap.set('standard', 0.2)
  jsPkgWeightsMap.set('veggie-burrito', 0.3)
  t.context.jsPkgWeightsMap = jsPkgWeightsMap

  const pipPkgWeightsMap = new Map()
  pipPkgWeightsMap.set('pip-deep-equals', 0.001)
  pipPkgWeightsMap.set('pylib', 0.01)
  pipPkgWeightsMap.set('veggie-burrito-python', 0.1)
  t.context.pipPkgWeightsMap = pipPkgWeightsMap
})

test.after(() => {
  Date.now.restore()
})

test.beforeEach((t) => {
  t.context.s3 = new S3({
    s3: {
      getObject: sinon.stub().returns({
        promise: sinon.stub().resolves({
          Body: JSON.stringify({
            organizationId: 'flossbank-id',
            amount: 1000,
            redistributeDonation: false
          })
        })
      })
    },
    config: {
      getBucketName: sinon.stub().returns('org-donation-state')
    }
  })
})

test('getInitialState | success', async (t) => {
  const initialState = await t.context.s3.getInitialState({ correlationId: 'test-org-id' })
  t.true(t.context.s3.s3.getObject.calledWith({
    Bucket: 'org-donation-state',
    Key: 'test-org-id/initial_state.json'
  }))
  t.deepEqual(initialState, {
    organizationId: 'flossbank-id',
    amount: 1000,
    redistributeDonation: false
  })
})

test('getPackageWeightMapForSupportedLangs | success', async (t) => {
  const { s3 } = t.context
  s3.s3.getObject().promise
    .onFirstCall().resolves({
      Body: JSON.stringify([...t.context.jsPkgWeightsMap.entries()])
    })
    .onSecondCall().resolves({
      Body: JSON.stringify([...t.context.pipPkgWeightsMap.entries()])
    })
  t.deepEqual(await s3.getPackageWeightMapForSupportedLangs({
    searchPatterns: [
      {
        language: 'js',
        registry: 'npm',
        patterns: []
      },
      {
        language: 'python',
        registry: 'pip',
        patterns: []
      }
    ],
    correlationId: 'asdf'
  }), [
    {
      language: 'js',
      registry: 'npm',
      weightMap: t.context.jsPkgWeightsMap
    },
    {
      language: 'python',
      registry: 'pip',
      weightMap: t.context.pipPkgWeightsMap
    }
  ])
})

test('getPackageWeightMapForSupportedLangs | one s3 request failed', async (t) => {
  const { s3 } = t.context
  s3.s3.getObject().promise
    .onFirstCall().resolves({
      Body: JSON.stringify([...t.context.jsPkgWeightsMap.entries()])
    })
    .onSecondCall().rejects('error')
  await t.throwsAsync(() => s3.getPackageWeightMapForSupportedLangs({
    searchPatterns: [
      {
        language: 'js',
        registry: 'npm',
        patterns: []
      },
      {
        language: 'python',
        registry: 'pip',
        patterns: []
      }
    ],
    correlationId: 'asdf'
  }))
})

test('getTopLevelDepsCount', async (t) => {
  const { s3 } = t.context
  const searchPatterns = [
    {
      language: 'javascript',
      registry: 'npm',
      patterns: []
    },
    {
      language: 'ruby',
      registry: 'rubygems',
      patterns: []
    }
  ]
  s3.s3.getObject().promise
    .onFirstCall()
    .resolves({
      Body: JSON.stringify(['standard', 'js-deep-equals'])
    })
    .onSecondCall()
    .resolves({
      Body: JSON.stringify(['json', 'json-thing'])
    })
  const count = await s3.getTopLevelDepsCount({ correlationId: 'asdf', searchPatterns })

  t.is(count, 4)
})
