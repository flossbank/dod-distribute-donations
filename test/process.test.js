const test = require('ava')
const sinon = require('sinon')
const Process = require('../lib/process')

test.beforeEach((t) => {
  const db = {
    getOrg: sinon.stub().resolves({
      name: 'flossbank',
      billingInfo: {
        manuallyBilled: true
      }
    }),
    distributeOrgDonation: sinon.stub(),
    updateDonatedAmount: sinon.stub(),
    createOrganizationOssUsageSnapshot: sinon.stub(),
    decrementManuallyBilledOrgRemainingDonation: sinon.stub()
  }
  t.context.packageWeightMaps = [
    {
      language: 'javascript',
      registry: 'npm',
      weightMap: new Map([['standard', 0.5], ['js-deep-equals', 0.2], ['yttrium-server', 0.3]])
    },
    {
      language: 'php',
      registry: 'idk',
      weightMap: new Map([['some-php-dep', 1]])
    },
    {
      language: 'ruby',
      registry: 'rubygems',
      weightMap: new Map()
    }
  ]
  const s3 = {
    getInitialState: sinon.stub().resolves(),
    getPackageWeightMapForSupportedLangs: sinon.stub().resolves(t.context.packageWeightMaps),
    getTopLevelDepsCount: sinon.stub().resolves(4)
  }
  const resolver = {
    getSupportedManifestPatterns: sinon.stub().resolves([{
      language: 'js',
      registry: 'npm',
      patterns: ['package.json']
    }])
  }
  const log = { info: sinon.stub() }

  t.context.services = {
    db,
    resolver,
    s3,
    log
  }

  t.context.initialState1 = {
    amount: 1000000,
    timestamp: 1234,
    organizationId: 'test-org-id',
    description: 'testing donation'
  }

  t.context.manuallyBilledInitialState = {
    amount: 1000000,
    timestamp: 1234,
    organizationId: 'test-org-id',
    description: undefined
  }

  t.context.undefinedOrgInitialState = {
    amount: 1000000,
    timestamp: 1234,
    organizationId: undefined,
    description: 'testing donation'
  }

  t.context.zeroAmountRecordInitialState = {
    amount: 0,
    timestamp: 1234,
    organizationId: 'test-org-id',
    description: 'testing donation'
  }

  t.context.targetPackageIdInitialState = {
    amount: 1000000,
    timestamp: 1234,
    organizationId: 'test-org-id',
    targetPackageId: 'aaaaaaaaaaaa',
    description: 'testing donation'
  }

  t.context.recordBody = {
    correlationId: 'asdf'
  }
  t.context.testRecord = {
    body: JSON.stringify(t.context.recordBody)
  }

  t.context.testRecordManuallyBilledBody = {
    correlationId: 'asdf'
  }
  t.context.testRecordManuallyBilled = {
    body: JSON.stringify(t.context.recordBody)
  }

  t.context.undefinedOrgRecordBody = {
    correlationId: 'asdf'
  }
  t.context.undefinedOrgTestBody = {
    body: JSON.stringify(t.context.undefinedOrgRecordBody)
  }

  t.context.zeroAmountRecordBody = {
    correlationId: 'asdf'
  }
  t.context.zeroAmountRecord = {
    body: JSON.stringify(t.context.zeroAmountRecordBody)
  }

  t.context.targetPackageIdRecordBody = {
    correlationId: 'asdf'
  }
  t.context.targetPackageIdRecord = {
    body: JSON.stringify(t.context.targetPackageIdRecordBody)
  }
})

test('process | success', async (t) => {
  const { services, testRecord, initialState1 } = t.context
  services.s3.getInitialState.resolves(initialState1)
  const res = await Process.process({
    record: testRecord,
    ...services
  })
  const expectedDonationAmount = (initialState1.amount * 0.96) - 30

  t.deepEqual(res, { success: true })
  t.true(services.s3.getInitialState.calledOnce)
  t.true(services.resolver.getSupportedManifestPatterns.calledOnce)
  t.true(services.s3.getPackageWeightMapForSupportedLangs.calledOnce)

  t.deepEqual(services.db.distributeOrgDonation.firstCall.firstArg, {
    donationAmount: Math.floor(expectedDonationAmount * (3 / 4)), // donation for 3 JavaScript deps out of 4 total deps found
    packageWeightsMap: new Map([['standard', 0.5], ['js-deep-equals', 0.2], ['yttrium-server', 0.3]]),
    language: 'javascript',
    description: 'testing donation',
    registry: 'npm',
    organizationId: 'test-org-id'
  })
  t.deepEqual(services.db.distributeOrgDonation.secondCall.firstArg, {
    donationAmount: Math.floor(expectedDonationAmount * (1 / 4)), // donation for 1 PHP dep out of 4 total deps found
    packageWeightsMap: new Map([['some-php-dep', 1]]),
    language: 'php',
    registry: 'idk',
    description: 'testing donation',
    organizationId: 'test-org-id'
  })
  t.true(services.db.createOrganizationOssUsageSnapshot.calledWith({
    organizationId: 'test-org-id',
    totalDependencies: 4,
    topLevelDependencies: 4
  }))
  t.true(services.db.updateDonatedAmount.calledWith({ organizationId: 'test-org-id', amount: initialState1.amount }))
})

test('process | success | manually billed org updates remaining donation amount -> 0', async (t) => {
  const { services, testRecordManuallyBilled, manuallyBilledInitialState } = t.context
  services.s3.getInitialState.resolves(manuallyBilledInitialState)
  const res = await Process.process({
    record: testRecordManuallyBilled,
    ...services
  })

  t.deepEqual(res, { success: true })
  t.true(services.db.updateDonatedAmount.calledWith({ organizationId: 'test-org-id', amount: manuallyBilledInitialState.amount }))
  t.true(services.db.decrementManuallyBilledOrgRemainingDonation.calledWith({ organizationId: 'test-org-id', amount: 1000000 }))
})

test('process | success | manually billed org updates remaining donation amount -> still remaining donation', async (t) => {
  const { services, testRecordManuallyBilled, manuallyBilledInitialState } = t.context
  services.s3.getInitialState.resolves(manuallyBilledInitialState)
  const res = await Process.process({
    record: testRecordManuallyBilled,
    ...services
  })

  t.deepEqual(res, { success: true })
  t.true(services.db.updateDonatedAmount.calledWith({ organizationId: 'test-org-id', amount: manuallyBilledInitialState.amount }))
  t.true(services.db.decrementManuallyBilledOrgRemainingDonation.calledWith({ organizationId: 'test-org-id', amount: 1000000 }))
})

test('process | targetPackageId | success', async (t) => {
  const { services, targetPackageIdRecord, targetPackageIdInitialState } = t.context
  services.s3.getInitialState.resolves(targetPackageIdInitialState)
  const res = await Process.process({
    record: targetPackageIdRecord,
    ...services
  })

  const expectedDonationAmount = targetPackageIdInitialState.amount * 0.96 - 30

  t.deepEqual(res, { success: true })
  t.true(services.s3.getInitialState.calledOnce)
  t.true(services.resolver.getSupportedManifestPatterns.calledOnce)
  t.true(services.s3.getPackageWeightMapForSupportedLangs.calledOnce)

  t.deepEqual(services.db.distributeOrgDonation.firstCall.firstArg, {
    donationAmount: Math.floor(expectedDonationAmount * (3 / 4)), // donation for 3 JavaScript deps out of 4 total deps found
    packageWeightsMap: new Map([['standard', 0.5], ['js-deep-equals', 0.2], ['yttrium-server', 0.3]]),
    language: 'javascript',
    description: 'testing donation',
    registry: 'npm',
    organizationId: 'test-org-id'
  })
  t.deepEqual(services.db.distributeOrgDonation.secondCall.firstArg, {
    donationAmount: Math.floor(expectedDonationAmount * (1 / 4)), // donation for 1 PHP dep out of 4 total deps found
    packageWeightsMap: new Map([['some-php-dep', 1]]),
    language: 'php',
    registry: 'idk',
    description: 'testing donation',
    organizationId: 'test-org-id'
  })
  t.true(services.db.createOrganizationOssUsageSnapshot.notCalled)
  t.true(services.db.updateDonatedAmount.calledWith({ organizationId: 'test-org-id', amount: targetPackageIdInitialState.amount }))
})

test('process | targetPackageId | redistribute | success', async (t) => {
  const { services, targetPackageIdRecord, targetPackageIdInitialState } = t.context
  services.s3.getInitialState.resolves({ ...targetPackageIdInitialState, redistributedDonation: true })
  services.s3.getPackageWeightMapForSupportedLangs.resolves([t.context.packageWeightMaps[1]])
  const res = await Process.process({
    record: targetPackageIdRecord,
    ...services
  })
  const expectedDonationAmount = targetPackageIdInitialState.amount

  t.deepEqual(res, { success: true })
  t.true(services.resolver.getSupportedManifestPatterns.calledOnce)
  t.deepEqual(services.db.distributeOrgDonation.lastCall.args, [{
    donationAmount: expectedDonationAmount,
    packageWeightsMap: t.context.packageWeightMaps[1].weightMap,
    description: targetPackageIdInitialState.description,
    language: 'php',
    registry: 'idk',
    organizationId: targetPackageIdInitialState.organizationId
  }])

  t.true(services.db.createOrganizationOssUsageSnapshot.notCalled)
  t.true(services.db.updateDonatedAmount.notCalled)
})

test('process | success - amount of 0', async (t) => {
  const { services, zeroAmountRecord, zeroAmountRecordInitialState } = t.context
  services.s3.getInitialState.resolves(zeroAmountRecordInitialState)
  const res = await Process.process({
    record: zeroAmountRecord,
    ...services
  })

  t.deepEqual(res, { success: true })

  t.true(services.db.distributeOrgDonation.notCalled)
  t.true(services.db.createOrganizationOssUsageSnapshot.calledWith({
    organizationId: 'test-org-id',
    totalDependencies: 4,
    topLevelDependencies: 4
  }))
})

test('process | failure, distributeOrgDonation fails', async (t) => {
  const { services } = t.context
  const { db } = services
  db.distributeOrgDonation.rejects()
  await t.throwsAsync(Process.process({
    record: t.context.testRecord,
    ...services
  }))
})
