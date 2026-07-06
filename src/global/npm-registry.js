export async function fetchPublishedVersion(packageName, fetchJson = defaultFetchJson) {
  const testVersion = process.env.HARNESS_TEST_LATEST_VERSION?.trim();
  if (testVersion) {
    return testVersion;
  }

  const encodedPackage = encodeURIComponent(packageName);
  const meta = await fetchJson(`https://registry.npmjs.org/${encodedPackage}/latest`);

  if (!meta?.version) {
    throw new Error(`Could not resolve latest version for ${packageName}.`);
  }

  return meta.version;
}

async function defaultFetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }

  return response.json();
}
