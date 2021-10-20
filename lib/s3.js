class S3 {
  constructor ({ s3 }) {
    this.s3 = s3
  }

  async getInitialState ({ correlationId }) {
    const params = {
      Bucket: 'org-donation-state',
      Key: `${correlationId}/initial_state.json`
    }
    const res = await this.s3.getObject(params).promise()
    return JSON.parse(res.Body)
  }

  async getPackageWeightMapForSupportedLangs ({ searchPatterns, correlationId }) {
    return Promise.all(searchPatterns.map(async ({ language, registry }) => {
      const params = {
        Bucket: 'org-donation-state',
        Key: `${correlationId}/${language}_${registry}_package_weight_map.json`
      }
      const res = await this.s3.getObject(params).promise()
      return {
        language,
        registry,
        weightMap: new Map(JSON.parse(res.Body))
      }
    }))
  }

  async getTopLevelDepsCount ({ searchPatterns, correlationId }) {
    const res = await Promise.all(searchPatterns.map(async ({ language, registry }) => {
      const params = {
        Bucket: 'org-donation-state',
        Key: `${correlationId}/${language}_${registry}_top_level_packages.json`
      }
      const res = await this.s3.getObject(params).promise()
      return JSON.parse(res.Body)
    }))
    return res.reduce(({ acc, tlpList }) => acc + tlpList.length, 0)
  }
}

module.exports = S3
