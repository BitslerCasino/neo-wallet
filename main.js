import Neo from './wrapper';

Neo.run().catch(console.error)

process.on('SIGTERM', () => {
  console.info('SIGTERM signal received.Saving store to .cache folder');
  Neo.save();
  process.exit(0);
});
process.on('SIGINT', () => {
  console.info('SIGINT signal received.Saving store to .cache folder');
  Neo.save();
  process.exit(0);
}); 
