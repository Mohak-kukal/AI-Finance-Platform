const db = require('../config/database');

/**
 * Process recurring transactions for the current month
 * This should be called daily to check if any recurring transactions need to be created
 */
async function processRecurringTransactions() {
  try {
    const now = new Date();
    const currentDay = now.getDate();
    const currentMonth = now.getMonth() + 1; // 1-12
    const currentYear = now.getFullYear();
    
    // Find all active recurring transactions that:
    // 1. Are active
    // 2. Haven't been processed this month yet
    // 3. Haven't reached their end date (if set)
    // 4. Either haven't been processed before, OR the day_of_month has passed in the current month,
    //    OR if last_processed was in a previous month (allows processing in new month even if day hasn't passed)
    
    const recurringTransactions = await db('recurring_transactions')
      .where('is_active', true)
      .where(function() {
        this.whereNull('end_date')
            .orWhere('end_date', '>=', `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(currentDay).padStart(2, '0')}`);
      })
      .where(function() {
        // Check if not processed this month
        this.whereNull('last_processed')
            .orWhereRaw('EXTRACT(YEAR FROM last_processed) != ?', [currentYear])
            .orWhereRaw('EXTRACT(MONTH FROM last_processed) != ?', [currentMonth]);
      })
      .where(function() {
        // Process if: never processed before, OR day_of_month has passed in current month,
        // OR if last_processed was in a previous month/year (allows processing in new month)
        // This fixes the issue where transactions on day 30+ don't get processed in new months
        this.whereNull('last_processed')
            .orWhere('day_of_month', '<=', currentDay)
            .orWhereRaw('EXTRACT(YEAR FROM last_processed) < ?', [currentYear])
            .orWhereRaw('(EXTRACT(YEAR FROM last_processed) = ? AND EXTRACT(MONTH FROM last_processed) < ?)', [currentYear, currentMonth]);
      });

    console.log(`Found ${recurringTransactions.length} recurring transactions to process`);

    let totalProcessed = 0;

    for (const recurring of recurringTransactions) {
      try {
        // Determine the starting point: use last_processed if exists, otherwise use start_date
        let startDate = recurring.last_processed 
          ? new Date(recurring.last_processed)
          : new Date(recurring.start_date);
        
        // IMPORTANT: If last_processed is in the future, reset it to null and use start_date instead
        // This corrects any bad data and prevents processing future dates
        if (recurring.last_processed && new Date(recurring.last_processed) > now) {
          console.log(`Warning: Recurring transaction ${recurring.id} has future last_processed date ${recurring.last_processed}, resetting to null`);
          await db('recurring_transactions')
            .where('id', recurring.id)
            .update({ last_processed: null });
          startDate = new Date(recurring.start_date);
        }
        
        // IMPORTANT: If startDate is in the future, use current date instead
        // This prevents processing future dates
        if (startDate > now) {
          console.log(`Warning: Recurring transaction ${recurring.id} has future start date ${startDate.toISOString()}, using current date instead`);
          startDate = new Date(now);
        }
        
        const startMonth = startDate.getMonth() + 1; // Convert to 1-based
        const startYear = startDate.getFullYear();
        
        // Calculate all months between start and current month that need transactions
        const monthsToProcess = [];
        let month = startMonth;
        let year = startYear;
        
        // Start from the month after last_processed (or start_date if never processed)
        month += 1;
        if (month > 12) {
          month = 1;
          year += 1;
        }
        
        // Generate list of months up to and including current month
        // IMPORTANT: Never process future months
        while (year < currentYear || (year === currentYear && month <= currentMonth)) {
          monthsToProcess.push({ month, year });
          month += 1;
          if (month > 12) {
            month = 1;
            year += 1;
          }
          // Safety check: break if we've exceeded current month/year
          if (year > currentYear || (year === currentYear && month > currentMonth)) {
            break;
          }
        }
        
        console.log(`Processing recurring transaction ${recurring.id}: ${monthsToProcess.length} months to process (from ${startMonth}/${startYear} to ${currentMonth}/${currentYear})`);
        
        let lastProcessedDate = null;
        const amount = recurring.is_expense ? -recurring.amount : recurring.amount;
        
        // Process each month
        for (const { month: targetMonth, year: targetYear } of monthsToProcess) {
          // Check if transaction already exists for this month
          const existingTransaction = await db('transactions')
            .where({
              user_id: recurring.user_id,
              account_id: recurring.account_id,
              recurring_transaction_id: recurring.id
            })
            .whereRaw('EXTRACT(YEAR FROM date) = ?', [targetYear])
            .whereRaw('EXTRACT(MONTH FROM date) = ?', [targetMonth])
            .first();

          if (existingTransaction) {
            console.log(`Transaction already exists for recurring transaction ${recurring.id} in ${targetMonth}/${targetYear}`);
            // Use the existing transaction date as last_processed only if it's not in the future
            const existingDate = new Date(existingTransaction.date);
            if (existingDate <= now) {
              lastProcessedDate = existingTransaction.date;
            }
            continue;
          }

          // Calculate the transaction date for the target month
          // Use the day_of_month, but adjust if it's beyond the last day of the month
          const lastDayOfMonth = new Date(targetYear, targetMonth, 0).getDate();
          const transactionDay = Math.min(recurring.day_of_month, lastDayOfMonth);
          const transactionDate = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(transactionDay).padStart(2, '0')}`;
          const transactionDateObj = new Date(transactionDate);

          // IMPORTANT: Only create transactions for dates that are today or in the past
          // Never create transactions for future dates
          if (transactionDateObj > now) {
            console.log(`Skipping recurring transaction ${recurring.id} for ${targetMonth}/${targetYear} - transaction date ${transactionDate} is in the future`);
            break; // Stop processing if we've reached future dates
          }

          // Check if end_date has passed
          if (recurring.end_date && transactionDateObj > new Date(recurring.end_date)) {
            console.log(`Skipping recurring transaction ${recurring.id} for ${targetMonth}/${targetYear} - end_date has passed`);
            break; // Stop processing if we've reached the end date
          }

          // Create the transaction
          const [transaction] = await db('transactions').insert({
            user_id: recurring.user_id,
            account_id: recurring.account_id,
            date: transactionDate,
            amount: amount,
            merchant: recurring.merchant,
            description: recurring.description,
            category: recurring.category,
            is_recurring: false,
            recurring_transaction_id: recurring.id
          }).returning('*');

          // Update account balance
          await db('accounts')
            .where({ id: recurring.account_id, user_id: recurring.user_id })
            .update({
              balance: db.raw('balance + ?', [amount])
            });

          // Only set lastProcessedDate if the transaction date is today or in the past
          if (transactionDateObj <= now) {
            lastProcessedDate = transactionDate;
          }
          totalProcessed += 1;

          console.log(`Created recurring transaction ${transaction.id} for user ${recurring.user_id} on ${transactionDate}`);
        }

        // Update last_processed to the most recent processed date (only if it's not in the future)
        if (lastProcessedDate) {
          const lastProcessedDateObj = new Date(lastProcessedDate);
          // Only update if lastProcessedDate is today or in the past
          if (lastProcessedDateObj <= now) {
            await db('recurring_transactions')
              .where('id', recurring.id)
              .update({ last_processed: lastProcessedDate });
          } else {
            console.log(`Warning: Not updating last_processed for recurring transaction ${recurring.id} - date ${lastProcessedDate} is in the future`);
          }
        }
      } catch (error) {
        console.error(`Error processing recurring transaction ${recurring.id}:`, error);
      }
    }

    return { processed: totalProcessed };
  } catch (error) {
    console.error('Error processing recurring transactions:', error);
    throw error;
  }
}

module.exports = { processRecurringTransactions };





