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

	displayName = 'IntellX for Sage X3 API';

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

	/**
	 * The test must exercise exactly what the node does: a POST on /soap-generic.
	 *
	 * An earlier version issued a GET on the /soap-wsdl path instead. That passes
	 * against any web server answering 200 on a GET — a reverse proxy or a SPA
	 * front-end in front of X3 does exactly that — while the node's POST is then
	 * refused with 405. The credential reported success and the failure only
	 * surfaced at execution time, pointing at the node rather than the URL.
	 *
	 * The body is a well-formed `run` call carrying an empty GRP1. X3 answers it
	 * with HTTP 200 and a business error inside the envelope, which is all the
	 * test needs: reaching that point proves the endpoint accepts POST, that Basic
	 * auth was accepted and that the pool answered. Nothing is read or written.
	 *
	 * Written with no `{{` or `}}` sequence outside the credential placeholders,
	 * so the expression parser cannot mistake the JSON braces for an expression.
	 */
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{ $credentials.baseUrl.replace(/\\/+$/, "") }}',
			url: '/soap-generic/syracuse/collaboration/syracuse/CAdxWebServiceXmlCC',
			method: 'POST',
			headers: {
				'Content-Type': 'text/xml; charset=utf-8',
				SOAPAction: '""',
			},
			body:
				'=<soapenv:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wss="http://www.adonix.com/WSS">' +
				'<soapenv:Header/><soapenv:Body>' +
				'<wss:run soapenv:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
				'<callContext xsi:type="wss:CAdxCallContext">' +
				'<codeLang xsi:type="xsd:string">{{ $credentials.codeLang }}</codeLang>' +
				'<poolAlias xsi:type="xsd:string">{{ $credentials.poolAlias }}</poolAlias>' +
				'<poolId xsi:type="xsd:string">{{ $credentials.poolId }}</poolId>' +
				'<requestConfig xsi:type="xsd:string">{{ $credentials.requestConfig }}</requestConfig>' +
				'</callContext>' +
				'<publicName xsi:type="xsd:string">XCHATX3OBJ</publicName>' +
				'<inputXml xsi:type="xsd:string"><![CDATA[' +
				'{ "GRP1": { "XOBJECT": "", "XTRANSACTION": "", "XACTION": "", "XIDENT": "", "XDATAJSON": "", "XRETURNJSON": "" } } ' +
				']]></inputXml>' +
				'</wss:run></soapenv:Body></soapenv:Envelope>',
			encoding: 'text',
			skipSslCertificateValidation: '={{$credentials.allowSelfSigned}}',
		},
		rules: [
			{
				type: 'responseCode',
				properties: {
					value: 405,
					message:
						'The Base URL does not point at the Sage X3 SOAP service — it answered 405 Method Not Allowed to a POST. Base URL must be scheme + host + port only (e.g. https://x3-server:8124); the SOAP path is appended automatically. A missing port is the most common cause: Syracuse usually listens on 8124 or 8443, not on 443.',
				},
			},
			{
				type: 'responseCode',
				properties: {
					value: 404,
					message:
						'The Sage X3 SOAP endpoint was not found at this Base URL. Check the host and port; the node appends /soap-generic/syracuse/collaboration/syracuse/CAdxWebServiceXmlCC on its own.',
				},
			},
			{
				type: 'responseCode',
				properties: {
					value: 401,
					message:
						'Sage X3 rejected the credentials — check the Syracuse username and password.',
				},
			},
			{
				type: 'responseCode',
				properties: {
					value: 403,
					message:
						'Sage X3 refused access to the SOAP service — the Syracuse user exists but is not allowed to call the web service.',
				},
			},
		],
	};
}
