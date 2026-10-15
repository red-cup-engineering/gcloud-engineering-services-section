const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.length > 0;
const unavailable = reason => ({status:'unavailable', reason});
const observed = value => value?.status === 'observed';
function list(reading, valid = object) {
  if (!observed(reading)) return reading;
  return Array.isArray(reading.value) && reading.value.every(valid)
    ? reading : unavailable('invalid-native-list');
}

/** Google-native inventory. Provider command execution is supplied by its host;
 * this module only defines Google requests and interprets Google responses.
 */
export async function observeGoogleCloudComputeResources(configuration, {jsonCommand} = {}) {
  const region = configuration?.cloudRunRegion;
  if (!nonempty(region) || !/^[a-z][a-z0-9-]+$/u.test(region) || typeof jsonCommand !== 'function')
    throw new TypeError('Google observation needs an explicit Cloud Run region and command boundary');
  const gcloud = args => jsonCommand('gcloud', [...args, '--format=json', '--quiet'],
    {CLOUDSDK_CORE_DISABLE_PROMPTS:'1'});
  const accounts = list(await gcloud(['auth','list']), row => object(row) && nonempty(row.account));
  const projectsReading = list(await gcloud(['projects','list']), row => object(row) && nonempty(row.projectId));
  const projects = [];
  if (observed(projectsReading)) for (const project of projectsReading.value) {
    const id = project.projectId;
    let billing = await gcloud(['billing','projects','describe',id]);
    if (observed(billing) && (!object(billing.value) || typeof billing.value.billingEnabled !== 'boolean'))
      billing = unavailable('invalid-native-billing');
    const services = list(await gcloud(['services','list','--enabled',`--project=${id}`]),
      row => object(row) && nonempty(row.config?.name));
    const enabled = observed(services) ? services.value.map(entry => entry.config.name) : [];
    const disabled = () => observed(services) ? {status:'not-enabled'} : unavailable('enabled-services-unobserved');
    const run = enabled.includes('run.googleapis.com')
      ? list(await gcloud(['run','services','list',`--project=${id}`,'--platform=managed',`--region=${region}`]),
        row => object(row) && nonempty(row.metadata?.name)) : disabled();
    const storage = enabled.includes('storage.googleapis.com')
      ? list(await gcloud(['storage','buckets','list',`--project=${id}`]), row => object(row) && nonempty(row.name)) : disabled();
    const compute = billing.value?.billingEnabled === false
      ? unavailable('billing-disabled; Compute Engine list cannot establish an empty inventory')
      : enabled.includes('compute.googleapis.com')
        ? list(await gcloud(['compute','instances','list',`--project=${id}`]),
          row => object(row) && nonempty(row.name) && nonempty(row.zone)) : disabled();
    projects.push({projectId:id, name:project.name, lifecycle:project.lifecycleState,
      billing:observed(billing) ? {status:'observed',enabled:billing.value.billingEnabled} : billing,
      enabledComputeServices:enabled.filter(name => /^(compute|run|cloudfunctions|cloudbuild|storage|artifactregistry)\.googleapis\.com$/u.test(name)),
      enabledServicesStatus:services.status,
      cloudRun:observed(run) ? {region,status:'observed',services:run.value.map(service => {
        const ready = (Array.isArray(service.status?.conditions)?service.status.conditions:[])
          .find(condition => condition?.type === 'Ready');
        return {name:service.metadata.name,url:service.status?.url,ready:ready?.status,
          readyReason:ready?.reason,latestCreatedRevision:service.status?.latestCreatedRevisionName,
          latestReadyRevision:service.status?.latestReadyRevisionName,
          traffic:(Array.isArray(service.status?.traffic)?service.status.traffic:[]).map(target =>
            ({revision:target.revisionName,percent:target.percent??0,tag:target.tag}))};
      })} : {...run,region},
      storageBuckets:observed(storage) ? {status:'observed',buckets:storage.value.map(bucket =>
        ({name:bucket.name,location:bucket.location??null,storageClass:bucket.storageClass??null}))} : storage,
      computeInstances:observed(compute) ? {status:'observed',instances:compute.value.map(instance =>
        ({name:instance.name,zone:instance.zone.split('/').at(-1),status:instance.status,
          machineType:instance.machineType?.split('/').at(-1)}))} : compute,
    });
  }
  return {status:projectsReading.status,...(!observed(projectsReading)?{reason:projectsReading.reason}:{}),
    projects,accounts:observed(accounts)?accounts.value.map(account=>({name:account.account,status:account.status})):[],
    accountStatus:accounts.status};
}
