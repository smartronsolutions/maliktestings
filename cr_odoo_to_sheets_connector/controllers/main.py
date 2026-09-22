# -*- coding: utf-8 -*-
import json
import logging
import time
from odoo import http
from odoo.http import request

_logger = logging.getLogger(__name__)

class CrGoogleSheetConnectorController(http.Controller):

    def _get_request_data(self, **kwargs):
        """Extracts JSON body and merges URL kwargs and args."""
        data = {}
        try:
            data = request.get_json_data() or {}
        except Exception:
            pass
        if not data:
            try:
                raw = request.httprequest.get_data(as_text=True)
                if raw:
                    data = json.loads(raw)
            except Exception:
                pass
        if not data:
            data = {}
        if kwargs:
            for k, v in kwargs.items():
                if k not in data or data[k] is None:
                    data[k] = v
        for k, v in request.httprequest.args.items():
            if k not in data or data[k] is None:
                data[k] = v
        return data

    def _authenticate_token(self, data, **kwargs):
        """Validates bearer token or access_token param against config."""
        auth_header = request.httprequest.headers.get('Authorization', '')
        token = ''
        if auth_header.startswith('Bearer '):
            token = auth_header.split('Bearer ', 1)[1].strip()
        elif data.get('access_token'):
            token = str(data.get('access_token')).strip()
        elif kwargs.get('access_token'):
            token = str(kwargs.get('access_token')).strip()
        elif request.httprequest.args.get('access_token'):
            token = str(request.httprequest.args.get('access_token')).strip()
        elif request.httprequest.form.get('access_token'):
            token = str(request.httprequest.form.get('access_token')).strip()

        if not token:
            _logger.warning("Google Sheet Connector: Authentication failed - no token provided in header, body, or URL args.")
            return False

        config = request.env['cr.google.sheet.connector.config'].sudo().search([
            ('access_token', '=', token)
        ], limit=1)
        if not config:
            _logger.warning("Google Sheet Connector: Token '%s' not found in database.", token[:6] + '...' if len(token) > 6 else token)
            return False
        return True

    @http.route('/api/odoo_to_sheets/test_connection', type='http', auth='public', methods=['POST', 'GET'], cors='*', csrf=False)
    def test_connection(self, **kwargs):
        """Test API connection and token validity."""
        data = self._get_request_data(**kwargs)
        if not self._authenticate_token(data, **kwargs):
            return request.make_json_response({'status': 'error', 'message': 'Invalid or missing Access Token.'})
        return request.make_json_response({
            'status': 'success',
            'message': 'Connected to Odoo 19 successfully!'
        })

    @http.route('/api/odoo_to_sheets/models', type='http', auth='public', methods=['POST', 'GET'], cors='*', csrf=False)
    def get_models(self, **kwargs):
        """Retrieve list of available models for Google Sheets sync."""
        start_time = time.time()
        data = self._get_request_data(**kwargs)
        if not self._authenticate_token(data, **kwargs):
            return request.make_json_response({'status': 'error', 'message': 'Invalid or missing Access Token.'})

        try:
            models_records = request.env['ir.model'].sudo().search([
                ('transient', '=', False)
            ], order='name asc')

            models_data = [
                {'model': m.model, 'name': m.name or m.model}
                for m in models_records
                if not m.model.startswith('ir.actions') and not m.model.startswith('base.')
            ]

            duration = f"{time.time() - start_time:.2f}s"
            request.env['cr.data.processing.log'].create_log(
                operation_type='fetch_models',
                table_name='ir.model',
                total_records=len(models_data),
                successful_records=len(models_data),
                status='success',
                duration=duration,
                details=f"Successfully fetched {len(models_data)} models."
            )

            return request.make_json_response({'status': 'success', 'data': models_data})

        except Exception as e:
            duration = f"{time.time() - start_time:.2f}s"
            request.env['cr.data.processing.log'].create_log(
                operation_type='fetch_models',
                table_name='ir.model',
                total_records=0,
                successful_records=0,
                status='failed',
                duration=duration,
                details=str(e)
            )
            return request.make_json_response({'status': 'error', 'message': str(e)})

    @http.route('/api/odoo_to_sheets/fields', type='http', auth='public', methods=['POST', 'GET'], cors='*', csrf=False)
    def get_fields(self, **kwargs):
        """Retrieve list of fields for a specific model."""
        start_time = time.time()
        data = self._get_request_data(**kwargs)
        if not self._authenticate_token(data, **kwargs):
            return request.make_json_response({'status': 'error', 'message': 'Invalid or missing Access Token.'})

        model_name = data.get('model') or kwargs.get('model')
        if not model_name or model_name not in request.env:
            return request.make_json_response({'status': 'error', 'message': f"Model '{model_name}' does not exist."})

        try:
            model_obj = request.env[model_name].sudo()
            fields_dict = model_obj.fields_get()

            fields_data = []
            for fname, finfo in sorted(fields_dict.items(), key=lambda x: x[1].get('string', x[0])):
                if finfo.get('type') == 'binary':
                    continue
                fields_data.append({
                    'name': fname,
                    'string': finfo.get('string', fname),
                    'type': finfo.get('type', 'char'),
                    'required': finfo.get('required', False),
                    'readonly': finfo.get('readonly', False)
                })

            duration = f"{time.time() - start_time:.2f}s"
            request.env['cr.data.processing.log'].create_log(
                operation_type='fetch_fields',
                table_name=model_name,
                total_records=len(fields_data),
                successful_records=len(fields_data),
                status='success',
                duration=duration,
                details=f"Successfully fetched {len(fields_data)} fields for model {model_name}."
            )

            return request.make_json_response({'status': 'success', 'data': fields_data})

        except Exception as e:
            duration = f"{time.time() - start_time:.2f}s"
            request.env['cr.data.processing.log'].create_log(
                operation_type='fetch_fields',
                table_name=model_name or '',
                total_records=0,
                successful_records=0,
                status='failed',
                duration=duration,
                details=str(e)
            )
            return request.make_json_response({'status': 'error', 'message': str(e)})

    @http.route('/api/odoo_to_sheets/fetch_data', type='http', auth='public', methods=['POST', 'GET'], cors='*', csrf=False)
    def fetch_data(self, **kwargs):
        """Fetch records from Odoo to Google Sheets."""
        start_time = time.time()
        data = self._get_request_data(**kwargs)
        if not self._authenticate_token(data, **kwargs):
            return request.make_json_response({'status': 'error', 'message': 'Invalid or missing Access Token.'})

        model_name = data.get('model') or kwargs.get('model')
        selected_fields = data.get('fields') or kwargs.get('fields') or []
        domain = data.get('domain') or []
        limit = data.get('limit') or 2000

        if not model_name or model_name not in request.env:
            return request.make_json_response({'status': 'error', 'message': f"Model '{model_name}' not found."})

        if 'id' not in selected_fields:
            selected_fields = ['id'] + [f for f in selected_fields if f != 'id']

        try:
            model_obj = request.env[model_name].sudo()
            fields_meta = model_obj.fields_get(selected_fields)

            records = model_obj.search_read(domain, selected_fields, limit=limit)

            formatted_records = []
            for rec in records:
                row_dict = {}
                for f in selected_fields:
                    val = rec.get(f)
                    ftype = fields_meta.get(f, {}).get('type')

                    if ftype == 'many2one' and isinstance(val, (list, tuple)) and len(val) == 2:
                        row_dict[f] = f"({val[0]}, '{val[1]}')"
                    elif ftype in ('many2many', 'one2many') and isinstance(val, (list, tuple)):
                        row_dict[f] = str(list(val))
                    elif isinstance(val, bool):
                        row_dict[f] = "TRUE" if val else "FALSE"
                    elif val is False or val is None:
                        row_dict[f] = ""
                    else:
                        row_dict[f] = str(val)

                formatted_records.append(row_dict)

            duration = f"{time.time() - start_time:.2f}s"
            request.env['cr.data.processing.log'].create_log(
                operation_type='odoo_to_sheet',
                table_name=model_name,
                total_records=len(formatted_records),
                successful_records=len(formatted_records),
                status='success',
                duration=duration,
                details=f"Exported {len(formatted_records)} records to Google Sheets."
            )

            return request.make_json_response({
                'status': 'success',
                'headers': selected_fields,
                'data': formatted_records,
                'total_records': len(formatted_records)
            })

        except Exception as e:
            duration = f"{time.time() - start_time:.2f}s"
            request.env['cr.data.processing.log'].create_log(
                operation_type='odoo_to_sheet',
                table_name=model_name or '',
                total_records=0,
                successful_records=0,
                status='failed',
                duration=duration,
                details=str(e)
            )
            return request.make_json_response({'status': 'error', 'message': str(e)})

    @http.route('/api/odoo_to_sheets/export_data', type='http', auth='public', methods=['POST'], cors='*', csrf=False)
    def export_data(self, **kwargs):
        """Export data from Google Sheets to Odoo with column-wise fallback mechanism."""
        start_time = time.time()
        data = self._get_request_data(**kwargs)
        if not self._authenticate_token(data, **kwargs):
            return request.make_json_response({'status': 'error', 'message': 'Invalid or missing Access Token.'})

        model_name = data.get('model') or kwargs.get('model')
        rows = data.get('rows') or kwargs.get('rows') or []

        if not model_name or model_name not in request.env:
            return request.make_json_response({'status': 'error', 'message': f"Model '{model_name}' not found."})

        model_obj = request.env[model_name].sudo()
        fields_info = model_obj.fields_get()

        total = len(rows)
        successful = 0
        failed = 0
        errors = []

        for idx, row in enumerate(rows):
            row_num = idx + 2
            row_id = row.get('id')
            record_id = None
            if row_id:
                try:
                    record_id = int(str(row_id).strip())
                except (ValueError, TypeError):
                    record_id = None

            prepared_vals = {}
            for col_name, raw_val in row.items():
                if col_name == 'id' or col_name not in fields_info:
                    continue

                f_meta = fields_info[col_name]
                if f_meta.get('readonly', False):
                    continue

                f_type = f_meta.get('type')
                str_val = str(raw_val).strip() if raw_val is not None else ""

                if str_val == "" and f_type in ('integer', 'float', 'monetary', 'date', 'datetime', 'many2one'):
                    prepared_vals[col_name] = False
                    continue

                try:
                    if f_type == 'boolean':
                        prepared_vals[col_name] = str_val.upper() in ('TRUE', '1', 'YES', 'T')
                    elif f_type == 'integer':
                        prepared_vals[col_name] = int(float(str_val))
                    elif f_type in ('float', 'monetary'):
                        prepared_vals[col_name] = float(str_val)
                    elif f_type == 'many2one':
                        if str_val.startswith('(') and ',' in str_val:
                            id_part = str_val.strip('()').split(',')[0].strip()
                            prepared_vals[col_name] = int(id_part)
                        elif str_val.isdigit():
                            prepared_vals[col_name] = int(str_val)
                        else:
                            rel_rec = request.env[f_meta['relation']].sudo().search([
                                ('name', '=', str_val)
                            ], limit=1)
                            if rel_rec:
                                prepared_vals[col_name] = rel_rec.id
                            else:
                                prepared_vals[col_name] = False
                    else:
                        prepared_vals[col_name] = str_val

                except Exception as ex:
                    errors.append(f"Row {row_num} column '{col_name}' format error: {str(ex)}")

            if not prepared_vals:
                continue

            record = None
            if record_id:
                record = model_obj.browse(record_id).exists()

            if record:
                try:
                    record.write(prepared_vals)
                    successful += 1
                except Exception as batch_err:
                    # Column-wise fallback mechanism
                    field_success = False
                    for fname, fval in prepared_vals.items():
                        try:
                            record.write({fname: fval})
                            field_success = True
                        except Exception as col_err:
                            errors.append(f"Row {row_num} (ID {record_id}) field '{fname}' write error: {str(col_err)}")

                    if field_success:
                        successful += 1
                    else:
                        failed += 1
                        errors.append(f"Row {row_num} (ID {record_id}) full write failed: {str(batch_err)}")
            else:
                try:
                    model_obj.create(prepared_vals)
                    successful += 1
                except Exception as create_err:
                    failed += 1
                    errors.append(f"Row {row_num} create failed: {str(create_err)}")

        duration = f"{time.time() - start_time:.2f}s"
        status = 'success'
        if failed > 0 and successful > 0:
            status = 'partial'
        elif failed > 0 and successful == 0:
            status = 'failed'

        request.env['cr.data.processing.log'].create_log(
            operation_type='sheet_to_odoo',
            table_name=model_name,
            total_records=total,
            successful_records=successful,
            status=status,
            duration=duration,
            details="\n".join(errors[:50]) if errors else f"Successfully imported {successful} records from sheet."
        )

        return request.make_json_response({
            'status': 'success',
            'total_records': total,
            'successful_records': successful,
            'failed_records': failed,
            'errors': errors
        })
