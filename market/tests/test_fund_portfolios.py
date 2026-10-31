"""Offline regression fixtures; real evidence audited separately on VPS."""
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from build_fund_portfolios import norm, percentage, extract, company_index, company_key, workbook


def rows():
    return {1:{2:('صندوق آزمون','')},3:{2:('برای ماه منتهی به 1405/06/31','')},5:{2:('سرمایه گذاری در سهام و حق تقدم سهام','')},7:{2:('شرکت',''),26:('درصد به کل دارایی ها','')},9:{2:('کلر پارس',''),26:('0.2','0.00%')},10:{2:('نقل به صفحه بعد',''),26:('0.2','0%')},11:{2:('نقل از صفحه قبل',''),26:('0.2','0%')},12:{2:('شرکت ناشناخته',''),26:('5','0.00')},13:{2:('ح . شرکت نمونه',''),26:('0.01','0%')},14:{2:('جمع',''),26:('0.26','0%')},15:{2:('شمش طلا',''),26:('0.1','0%')}}


class PortfolioTests(unittest.TestCase):
    def test_percent_formats(self):
        self.assertEqual(percentage('0.184356064397657','0.00%'),18.4356064397657)
        self.assertEqual(percentage('18.4','0.00'),18.4)
        self.assertEqual(percentage('۱۸٫۴٪','0%'),18.4)
        self.assertEqual(percentage('0.2','0.00"%"'),0.2)
        self.assertIsNone(percentage('#REF!','0%'))
        for x in ('NaN','-1','101'):
            with self.assertRaises(ValueError): percentage(x,'0')

    def test_strict_matching(self):
        metadata={'a':{'symbol':'کلر','info':{'lVal30':'کلر پارس','sector':{'lSecVal':'شیمیایی'}}},'b':{'symbol':'دوم','info':{'lVal30':'نام مشترک'}},'c':{'symbol':'سوم','info':{'lVal30':'نام مشترک'}}}
        ix=company_index(metadata)
        self.assertNotIn(norm('کلر'),ix)
        self.assertIn(company_key('کلر پارس (کلر)'),ix)
        self.assertNotIn(company_key('نام دیگر (کلر)'),ix)
        self.assertEqual(len(ix[norm('نام مشترک')]),2)
        self.assertEqual(norm('بانك\u200c تجارت'),norm('بانک تجارت'))

    def test_boundaries_unknowns_and_totals(self):
        with patch('build_fund_portfolios.workbook',return_value=[('سهام',rows()),('درآمد سهام',rows()),('سپرده کالایی',rows())]):
            hs,proof=extract('unused','آزمون','1405/06/31',{})
        self.assertEqual([h['name'] for h in hs],['کلر پارس','شرکت ناشناخته'])
        self.assertEqual([h['source_row'] for h in hs],[9,12])
        self.assertEqual(sum(h['weight_pct'] for h in hs),25)
        self.assertIsNone(hs[1]['symbol']);self.assertIsNone(hs[1]['industry'])
        self.assertEqual(proof[0]['disclosed_table_total_pct'],26)
        self.assertEqual(proof[0]['excluded_non_equity_pct'],1)

    def test_total_mismatch_rejected(self):
        r=rows();r[14][26]=('0.5','0%')
        with patch('build_fund_portfolios.workbook',return_value=[('سهام',r)]):
            with self.assertRaisesRegex(ValueError,'total mismatch'): extract('x','آزمون','1405/06/31',{})

    def test_wrong_identity_rejected(self):
        with patch('build_fund_portfolios.workbook',return_value=[('سهام',rows())]):
            with self.assertRaisesRegex(ValueError,'identity'): extract('x','دیگری','1405/06/31',{})

    def test_merged_hidden_values_and_sparse_coordinates(self):
        ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'fixture.xlsx'
            with zipfile.ZipFile(p,'w') as z:
                z.writestr('xl/workbook.xml',f'<workbook xmlns="{ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="سهام" sheetId="1" r:id="r1"/></sheets></workbook>')
                z.writestr('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>')
                z.writestr('xl/styles.xml',f'<styleSheet xmlns="{ns}"><cellXfs><xf numFmtId="0"/><xf numFmtId="10"/></cellXfs></styleSheet>')
                z.writestr('xl/worksheets/sheet1.xml',f'<worksheet xmlns="{ns}"><sheetData><row r="3"><c r="A3" t="inlineStr"><is><t>1405/06/31</t></is></c><c r="B3" t="inlineStr"><is><t>1403/11/30</t></is></c></row><row r="9"><c r="B9" t="inlineStr"><is><t>بانک تجارت</t></is></c><c r="AB9" s="1"><v>0.184356064397657</v></c></row></sheetData><mergeCells><mergeCell ref="A3:Y3"/></mergeCells></worksheet>')
            sh,r=next(workbook(p))
            self.assertNotIn(2,r[3])
            self.assertEqual(r[9][2][0],'بانک تجارت')
            self.assertEqual(percentage(*r[9][28]),18.4356064397657)

if __name__=='__main__': unittest.main()
