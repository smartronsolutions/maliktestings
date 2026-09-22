# -*- coding: utf-8 -*-
import base64
import os
import secrets
from odoo import models, fields, api, _
from odoo.exceptions import UserError

class CrGoogleSheetConnectorConfig(models.Model):
    _name = 'cr.google.sheet.connector.config'
    _description = 'Google Sheet Connector Configuration'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'id desc'

    name = fields.Char(string='Name', default='Google Sheet Connector', tracking=True)
    connector_url = fields.Char(string='Connector Url', default=lambda self: self._default_connector_url(), tracking=True)
    access_token = fields.Char(string='Access Token', readonly=True, copy=False, tracking=True)

    @api.model
    def _default_connector_url(self):
        base_url = self.env['ir.config_parameter'].sudo().get_param('web.base.url', '')
        if base_url and base_url.startswith('http://') and 'localhost' not in base_url and '127.0.0.1' not in base_url:
            base_url = 'https://' + base_url[7:]
        return base_url.rstrip('/') if base_url else ''

    def action_generate_token(self):
        """Generates a secure random 32-hex access token."""
        for record in self:
            token = secrets.token_hex(16)
            record.write({'access_token': token})
            record.message_post(body=_("Authentication token has been generated successfully."))
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': _('Success'),
                'message': _('Access token has been generated.'),
                'type': 'success',
                'sticky': False,
                'next': {
                    'type': 'ir.actions.client',
                    'tag': 'reload',
                },
            }
        }

    def action_generate_app_script(self):
        """Generates Google Apps Script file and posts it in chatter."""
        self.ensure_one()
        if not self.connector_url:
            raise UserError(_("Please configure the Connector Url before generating the App Script."))
        if not self.access_token:
            token = secrets.token_hex(16)
            self.write({'access_token': token})

        # Load Apps Script template
        curr_dir = os.path.dirname(os.path.abspath(__file__))
        template_path = os.path.join(os.path.dirname(curr_dir), 'data', 'app_script_template.js')

        if not os.path.exists(template_path):
            raise UserError(_("App Script template not found at %s") % template_path)

        with open(template_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # Substitute tokens (ensuring https to avoid 301 redirect POST body drops)
        url = self.connector_url or ''
        if url.startswith('http://') and 'localhost' not in url and '127.0.0.1' not in url:
            url = 'https://' + url[7:]
        content = content.replace('{{CONNECTOR_URL}}', url)
        content = content.replace('{{ACCESS_TOKEN}}', self.access_token or '')

        # Create ir.attachment
        file_bytes = content.encode('utf-8')
        attachment = self.env['ir.attachment'].create({
            'name': 'google_script.js',
            'type': 'binary',
            'datas': base64.b64encode(file_bytes),
            'mimetype': 'application/javascript',
            'res_model': self._name,
            'res_id': self.id,
        })

        # Post in chatter matching reference screenshot:
        # "Here is the generated Google Apps Script." with attached google_script.js
        self.message_post(
            body=_("Here is the generated Google Apps Script."),
            attachment_ids=[attachment.id]
        )

        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': _('Script Generated'),
                'message': _('Google Apps Script has been generated and attached to chatter. %s'),
                'type': 'success',
                'sticky': False,
                'links': [{
                    'label': _('Download google_script.js'),
                    'url': f'/web/content/{attachment.id}?download=true',
                }],
                'next': {
                    'type': 'ir.actions.client',
                    'tag': 'reload',
                },
            }
        }

