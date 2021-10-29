// Subtract 3% for stripe percentage fee and 1% for our fee
// Subtract 30 cents for stripe base charge
const adjustAmount = (amount) => amount <= 0 ? 0 : (amount * 0.96) - 30

exports.process = async ({ log, record, db, resolver, s3 }) => {
  const {
    correlationId
  } = JSON.parse(record.body)

  // If no correlation id, throw
  if (!correlationId) throw Error('no correlation id passed in')

  log.info({ correlationId })

  // Fetch from s3 the package weights map for each lang_registry as well as initial state
  const initialState = await s3.getInitialState({ correlationId })
  const {
    organizationId,
    amount,
    redistributedDonation,
    description,
    targetPackageId
  } = initialState

  // since this donation is not new, we already would have taken out our cut and Stripe's fees
  const donationAmount = redistributedDonation ? amount : adjustAmount(amount)
  const searchPatterns = resolver.getSupportedManifestPatterns()
  const packageWeightMaps = await s3.getPackageWeightMapForSupportedLangs({ searchPatterns, correlationId })

  // now time to distribute the donation to the packages present in the org's repos.
  // first we determine how many unique packages were found (or computed via dep graph traversal) across all
  // registries and languages. then we dedicate a portion of the donation to each registry/language based on
  // the number of packages found for that registry/language. finally, we update our DB, upserting any newly
  // found packages, and applying their weight to the donation portion.
  const totalPackages = packageWeightMaps.reduce((total, { weightMap }) => total + weightMap.size, 0)
  log.info('Dependencies across all supported downloaded manifests: %d', totalPackages)

  await Promise.all(packageWeightMaps.map(async ({ language, registry, weightMap }) => {
    // using Math.floor to guarantee we don't overspend due to floating point math issues
    const donationToLangReg = Math.floor(donationAmount * (weightMap.size / totalPackages))
    if (!donationToLangReg) return
    return db.distributeOrgDonation({
      donationAmount: donationToLangReg,
      packageWeightsMap: weightMap,
      description,
      language,
      registry,
      organizationId
    })
  }))

  const topLevelDepsCount = await s3.getTopLevelDepsCount({ searchPatterns, correlationId })

  // if we've just examined the organization's source control, we'll persist an OSS usage snapshot
  if (!targetPackageId) {
    await db.createOrganizationOssUsageSnapshot({
      organizationId,
      totalDependencies: totalPackages,
      topLevelDependencies: topLevelDepsCount
    })
  }

  // if this is a new donation, we'll update the organization's total amount donated
  if (!redistributedDonation) {
    // Update the donation amount for the organization, should be in millicents
    await db.updateDonatedAmount({ organizationId, amount })
  }

  const org = await db.getOrg({ organizationId })

  // If the org is manually billed, we need to decriment the amount we just distributed from the orgs remaining amount
  const isManuallyBilledOrganization = !!(org && org.billingInfo && org.billingInfo.manuallyBilled)
  log.info({ isManuallyBilledOrganization, org })
  if (isManuallyBilledOrganization) {
    log.info('decrimenting org remaining amount')
    await db.decrementManuallyBilledOrgRemainingDonation({ organizationId, amount })
  }

  log.info({ organizationId, donationAmount, description })
  return { success: true }
}
