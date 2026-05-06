import { useState, useEffect } from 'react';
import { localApi } from "@/lib/localApi";

interface Medicine {
  id: string;
  name: string;
  quantity: number;
  expiry_date: string;
}

export default function App() {
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState(0);

  useEffect(() => {
    loadMedicines();
  }, []);

  async function loadMedicines() {
    const { data, error } = await await localApi.from('medicines').select();
    if (data) setMedicines(data);
  }

  async function addMedicine() {
    const { error } = await await localApi.from('medicines').insert({ name, quantity, expiry_date: new Date().toISOString() });
    if (!error) {
      setName('');
      setQuantity(0);
      loadMedicines();
    }
  }

  async function deleteMedicine(id: string) {
    await await localApi.from('medicines').delete().eq('id', id);
    loadMedicines();
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>Pharmacy Tracker</h1>
      <div>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Medicine name" />
        <input type="number" value={quantity} onChange={e => setQuantity(+e.target.value)} placeholder="Qty" />
        <button onClick={addMedicine}>Add</button>
      </div>
      <ul>
        {medicines.map(m => (
          <li key={m.id}>
            {m.name} — qty: {m.quantity}
            <button onClick={() => deleteMedicine(m.id)}>✕</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
