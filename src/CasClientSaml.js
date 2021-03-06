'use strict';

const url = require('url');
const parseXML = require('xml2js').parseString;
const XMLprocessors = require('xml2js/lib/processors');
const AbstractCasClient = require('./AbstractCasClient');
const DefaultLoginUrl = '/login';
const DefaultValidateUrl = '/samlValidate';
const DefaultLogoutUrl = '/logout';

class CasClient extends AbstractCasClient {

  constructor(options) {
    options = options || {};
    options.cas = options.cas || {};
    options.cas.loginUrl = options.cas.loginUrl || DefaultLoginUrl;
    options.cas.validateUrl = options.cas.validateUrl || DefaultValidateUrl;
    options.cas.logoutUrl = options.cas.logoutUrl || DefaultLogoutUrl;
    super(options);
  }

  _buildValidateReqOptions(req) {
    // jshint ignore:start 
    var now = new Date();
    var data = `<?xml version="1.0" encoding="utf-8"?>
      <SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
        <SOAP-ENV:Header/>
        <SOAP-ENV:Body>
          <samlp:Request xmlns:samlp="urn:oasis:names:tc:SAML:1.0:protocol" MajorVersion="1"
            MinorVersion="1" RequestID="_${req.get(`host`)}.${now.getTime()}"
            IssueInstant="${now.toISOString()}">
            <samlp:AssertionArtifact>${req.query.ticket}</samlp:AssertionArtifact>
          </samlp:Request>
        </SOAP-ENV:Body>
      </SOAP-ENV:Envelope>`;
    // jshint ignore:end
    return {
      method: 'POST',
      url: url.format({
        host: this.validateUrl.host,
        pathname: this.validateUrl.pathname,
        protocol: this.validateUrl.protocol,
        query: {
          TARGET: this._buildService(req),
          ticket: ''
        }
      }),
      headers: {
        'Content-Type': 'text/xml',
        'Content-Length': Buffer.byteLength(data) // jshint ignore:line
      },
      body: data // jshint ignore:line
    };
  }

  _parseCasResponse(body, cb) {
    try {
      this.logger.debug('CASClientSaml::parseCasResponse  body:', body);
      parseXML(body, {
        trim: true,
        normalize: true,
        explicitArray: false,
        tagNameProcessors: [XMLprocessors.normalize, XMLprocessors.stripPrefix]
      }, (err, result) => {
        if (err) {
          return cb(new Error(`invalid CAS server response, ${err}`));
        }
        if (!result) {
          return cb(new Error(`invalid CAS server response, empty result`));
        }
        var samlResponse = result.envelope && result.envelope.body ?
          result.envelope.body.response : null;
        if (!samlResponse) {
          return cb(new Error(`invalid CAS server response, invalid format`));
        }
        var success = samlResponse.status && samlResponse.status.statuscode &&
          samlResponse.status.statuscode.$ &&
          samlResponse.status.statuscode.$.Value ?
          samlResponse.status.statuscode.$.Value.split(':')[1] : null;
        if (success !== 'Success') {
          // TODO - add error msg
          return cb(new Error(`CAS authentication failed (${success})`));
        }
        var user = samlResponse.assertion &&
          samlResponse.assertion.authenticationstatement &&
          samlResponse.assertion.authenticationstatement.subject ?
          samlResponse.assertion.authenticationstatement.subject.nameidentifier :
          null;
        var attrs = samlResponse.assertion &&
          samlResponse.assertion.attributestatement &&
          samlResponse.assertion.attributestatement.attribute ?
          samlResponse.assertion.attributestatement.attribute : [];
        var data = {
          user
        };
        if (!(attrs instanceof Array)) {
          attrs = [attrs];
        }
        attrs.forEach((attr) => {
          if (!attr) return;
          var thisAttrValue;
          if (attr.attributevalue instanceof Array) {
            thisAttrValue = [];
            attr.attributevalue.forEach((v) => thisAttrValue.push(v));
          } else {
            thisAttrValue = attr.attributevalue;
          }
          data[attr.$.AttributeName] = thisAttrValue;
        });
        return cb(null, data);
      });
    } catch (err) {
      this.logger.error(err);
      return cb(new Error(`invalid CAS server response, invalid format`));
    }
  }

}

module.exports = CasClient;