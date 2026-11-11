/** Keep a personal build at the same update precedence as its official base. */
function localBuildVersion(baseVersion, buildId) {
  if (buildId === undefined) return baseVersion
  if (
    typeof baseVersion !== 'string' ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
      baseVersion,
    )
  ) {
    throw new Error('Invalid base version for a local build')
  }
  const prerelease = baseVersion.split('+')[0].split('-').slice(1).join('-')
  if (prerelease.split('.').some((part) => /^0\d+$/.test(part))) {
    throw new Error('Invalid numeric prerelease identifier')
  }
  if (
    typeof buildId !== 'string' ||
    buildId.length > 64 ||
    !/^[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*$/.test(buildId)
  ) {
    throw new Error('IEUM_LOCAL_BUILD_ID must contain 1-64 version metadata characters')
  }
  return `${baseVersion}${baseVersion.includes('+') ? '.' : '+'}local.${buildId}`
}

module.exports = { localBuildVersion }
