import Page from './client-page.tsx';

export default async function PageWrapper({ params }: { params: Promise<{ service_name: string }> }) {
	const { service_name } = await params
	return <Page service_name={service_name} />;
}
