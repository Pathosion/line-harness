export function workerGuardResponse(url: string): Response | null {
  if (/\/workers\/scripts\/[^/]+\/versions\?/.test(url)) return Response.json({ success: true, result: { items: [{ id: 'deployed-version' }] } });
  if (/\/workers\/scripts\/[^/]+\/deployments\?/.test(url)) return Response.json({ success: true, result: { deployments: [{ id: 'active-deployment', strategy: 'percentage', versions: [{ version_id: 'deployed-version', percentage: 100 }] }] } });
  return null;
}
