# -*- coding: utf-8 -*-
from odoo import models, fields, api

class CrDataProcessingLog(models.Model):
    _name = 'cr.data.processing.log'
    _description = 'Data Processing Log'
    _order = 'started_at desc, id desc'

    name = fields.Char(string='Log Reference', default=lambda self: self._default_name(), copy=False)
    started_at = fields.Datetime(string='Started At', default=fields.Datetime.now, required=True)
    operation_type = fields.Selection([
        ('odoo_to_sheet', 'Odoo to Sheet'),
        ('sheet_to_odoo', 'Sheet to Odoo'),
        ('fetch_fields', 'Fetch Model Fields'),
        ('fetch_models', 'Fetch Models List')
    ], string='Operation Type', required=True, index=True)
    table_name = fields.Char(string='Table Name', index=True)
    total_records = fields.Integer(string='Total Records', default=0)
    successful_records = fields.Integer(string='Successful Records', default=0)
    status = fields.Selection([
        ('success', 'Success'),
        ('partial', 'Partial'),
        ('failed', 'Failed')
    ], string='Status', default='success', required=True, index=True)
    duration = fields.Char(string='Duration', default='0.00s')
    details = fields.Text(string='Details / Analytical Reason')
    company_id = fields.Many2one('res.company', string='Company', default=lambda self: self.env.company)

    @api.model
    def _default_name(self):
        return f"LOG-{fields.Datetime.now().strftime('%Y%m%d%H%M%S')}"

    @api.model
    def create_log(self, operation_type, table_name, total_records=0, successful_records=0, status='success', duration='0.00s', details=''):
        """Helper to create log entry easily from controller."""
        return self.sudo().create({
            'operation_type': operation_type,
            'table_name': table_name or '',
            'total_records': total_records,
            'successful_records': successful_records,
            'status': status,
            'duration': duration,
            'details': details or ''
        })

