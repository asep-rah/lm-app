// utils/exportCmsBriCsv.ts
export interface ExpenseItem {
    id: string;
    outlet_name?: string;
    beneficiary_account_no: string;
    beneficiary_account_name: string;
    beneficiary_bank: string;
    amount: number;
    description: string;
  }
  
  export function exportToBriCmsCsv(expenses: ExpenseItem[]) {
    // Format Kolom Standard Mass Fund Transfer BRI CMS:
    // AccountNo, AccountName, BankName, Amount, Remark/Ref
    const headers = ["Target_Account_No", "Target_Account_Name", "Bank_Name", "Amount", "Remark"];
    
    const rows = expenses.map(exp => [
      `"${exp.beneficiary_account_no.trim()}"`,
      `"${exp.beneficiary_account_name.replace(/"/g, '""')}"`,
      `"${exp.beneficiary_bank.trim().toUpperCase()}"`,
      exp.amount,
      `"EXP-${exp.id.slice(0, 6)}-${exp.description.replace(/"/g, '""').slice(0, 20)}"`
    ]);
  
    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
  
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    const today = new Date().toISOString().split('T')[0];
    
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `BRI_CMS_MassTransfer_${today}.csv`);
    document.body.appendChild(link);
    
    link.click();
    document.body.removeChild(link);
  }