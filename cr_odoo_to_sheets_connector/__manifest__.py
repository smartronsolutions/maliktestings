# -*- coding: utf-8 -*-
{
    'name': 'Odoo to Google Sheets Connector | Two-Way Data Sync & Automated Reporting',
    'version': '19.0.1.0.0',
    'category': 'Extra Tools',
    'summary': 'Bidirectional integration between Odoo ERP and Google Sheets with automated sync and logging.',
    'description': """
Odoo to Google Sheets Connector
===============================
The Odoo to Google Sheets Connector is a powerful bidirectional integration tool that seamlessly bridges your Odoo ERP system with Google Sheets. This connector eliminates manual data entry and enables real-time synchronization between both platforms, allowing users to work with familiar spreadsheet tools while maintaining data integrity in Odoo.

Key Features:
-------------
* Two-Way Data Sync between Odoo and Google Sheets
* One-click Google Apps Script generator attached directly to chatter
* Interactive Google Sheets dialogs to select tables and specific columns
* Column-wise fallback mechanism during data export to ensure maximum data integrity
* Automated import & export schedulers with custom hourly refresh intervals
* On-demand 'Refresh Now' synchronization for selected sheets
* Comprehensive logging in Odoo tracking successes, partial updates, failures, and execution times
    """,
    'author': 'Creyox Technologies',
    'website': 'https://www.creyox.com',
    'license': 'OPL-1',
    'depends': ['base', 'mail'],
    'data': [
        'security/ir.model.access.csv',
        'views/google_sheet_config_views.xml',
        'views/data_processing_log_views.xml',
        'views/menu_views.xml',
    ],
    'images': [
        'static/description/icon.png',
        'static/description/images/odoo_sheet_menu.png',
    ],
    'installable': True,
    'application': True,
    'auto_install': False,
}

