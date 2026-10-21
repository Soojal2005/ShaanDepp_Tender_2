/**
 * Module M9: Contractor KYB & Eligibility Verification Connector
 * Shan-Deep Tender Intelligence Platform (procure-brain.com)
 * Verifies GSTIN, MCA Company Master, and MSME/Udyam Exemption
 */

/**
 * Validates Indian GSTIN format (15 characters: 2 state + 10 PAN + 1 entity + 1 Z + 1 check)
 */
export function validateGstinFormat(gstin) {
  if (!gstin) return false;
  const regex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  return regex.test(gstin.trim().toUpperCase());
}

/**
 * Validates Indian Corporate Identification Number (CIN) format (21 chars)
 */
export function validateCinFormat(cin) {
  if (!cin) return false;
  const regex = /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;
  return regex.test(cin.trim().toUpperCase());
}

/**
 * Evaluates contractor financial eligibility against tender qualification criteria
 */
export function evaluateContractorEligibility(contractorProfile, tenderCriteria) {
  const results = [];
  let overallPassed = true;

  // 1. Minimum Average Annual Turnover Check
  if (tenderCriteria.minTurnover !== undefined && tenderCriteria.minTurnover !== null) {
    const passed = (contractorProfile.avgTurnover || 0) >= tenderCriteria.minTurnover;
    results.push({
      criterion: 'Average Annual Turnover (Last 3 FYs)',
      required: `₹ ${(tenderCriteria.minTurnover / 10000000).toFixed(2)} Cr`,
      actual: `₹ ${((contractorProfile.avgTurnover || 0) / 10000000).toFixed(2)} Cr`,
      passed
    });
    if (!passed) overallPassed = false;
  }

  // 2. Single Largest Similar Work Completed
  if (tenderCriteria.minSingleWork !== undefined && tenderCriteria.minSingleWork !== null) {
    const passed = (contractorProfile.maxCompletedWork || 0) >= tenderCriteria.minSingleWork;
    results.push({
      criterion: 'Single Similar Work Value',
      required: `₹ ${(tenderCriteria.minSingleWork / 10000000).toFixed(2)} Cr`,
      actual: `₹ ${((contractorProfile.maxCompletedWork || 0) / 10000000).toFixed(2)} Cr`,
      passed
    });
    if (!passed) overallPassed = false;
  }

  // 3. Solvency Certificate
  if (tenderCriteria.minSolvency !== undefined && tenderCriteria.minSolvency !== null) {
    const passed = (contractorProfile.solvencyAmount || 0) >= tenderCriteria.minSolvency;
    results.push({
      criterion: 'Bank Solvency Certificate',
      required: `₹ ${(tenderCriteria.minSolvency / 10000000).toFixed(2)} Cr`,
      actual: `₹ ${((contractorProfile.solvencyAmount || 0) / 10000000).toFixed(2)} Cr`,
      passed
    });
    if (!passed) overallPassed = false;
  }

  // 4. MSME EMD Exemption Status
  const isMsmeEligible = Boolean(contractorProfile.isUdyamRegistered && contractorProfile.msmeCategory !== 'Large');
  results.push({
    criterion: 'EMD Exemption Entitlement (MSME / Start-up)',
    required: 'Valid Udyam Certificate',
    actual: isMsmeEligible ? `Eligible (${contractorProfile.msmeCategory || 'Micro/Small'})` : 'Standard EMD Required',
    passed: true,
    isExempt: isMsmeEligible
  });

  return {
    overallPassed,
    checkpoints: results,
    evaluatedAt: new Date().toISOString()
  };
}
