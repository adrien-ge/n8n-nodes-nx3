import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

/**
 * Credential for Sage X3 SOAP web service (CAdxWebServiceXmlCC).
 * - Basic Authentication using Syracuse user/password
 * - Carries the X3 call context defaults (codeLang, poolAlias, poolId)
 *   so the node doesn't need to re-ask the user on every execution
 */
export class Nx3SoapApi implements ICredentialType {
	name = 'nx3SoapApi';

	displayName = 'nX3 by IntellX for Sage X3 API';

	icon: Icon = 'file:nx3.svg';

	documentationUrl =
		'https://online-help.sageerpx3.com/erp/12/wp-static-content/static-pages/en_US/web-services/Configuration_management.html';

	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: '',
			placeholder: 'https://kronk:8124',
			description:
				'Scheme + host + port of the X3 server. The SOAP endpoint path is appended automatically by the node.',
			required: true,
		},
		{
			displayName: 'Username',
			name: 'username',
			type: 'string',
			default: '',
			placeholder: 'admin',
			description: 'Syracuse user with permission to call the web service',
			required: true,
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
		},
		{
			displayName: 'Code Language',
			name: 'codeLang',
			type: 'string',
			default: 'FRA',
			description: 'Default codeLang passed in the CAdxCallContext (e.g. FRA, ENG)',
		},
		{
			displayName: 'Pool Alias',
			name: 'poolAlias',
			type: 'string',
			default: 'POOL_SEED',
			description: 'Default poolAlias passed in the CAdxCallContext',
		},
		{
			displayName: 'Pool ID',
			name: 'poolId',
			type: 'string',
			default: '',
			description: 'Default poolId passed in the CAdxCallContext (usually left empty)',
		},
		{
			displayName: 'Request Config',
			name: 'requestConfig',
			type: 'string',
			default: '',
			description: 'Default requestConfig passed in the CAdxCallContext (usually left empty)',
		},
		{
			displayName: 'Allow Self-Signed Certificates',
			name: 'allowSelfSigned',
			type: 'boolean',
			default: false,
			description:
				'Whether to skip TLS certificate validation. Useful for on-prem X3 with self-signed certs. Do not enable for production over the Internet.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			auth: {
				username: '={{$credentials.username}}',
				password: '={{$credentials.password}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/soap-wsdl/syracuse/collaboration/syracuse/CAdxWebServiceXmlCC?wsdl',
			method: 'GET',
			skipSslCertificateValidation: '={{$credentials.allowSelfSigned}}',
		},
	};
}
