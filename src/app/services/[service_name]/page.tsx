import Page from './client-page';

export default async function PageWrapper({ params }: { params: { service_name: string } }) {
	const { service_name } = await params
	return <Page service_name={service_name} />;
}
